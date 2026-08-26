'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Claim form states
  const [eliteGroup, setEliteGroup] = useState('Elite 1')
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState('')
  const [products, setProducts] = useState([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [claimedQty, setClaimedQty] = useState('')
  const [medRep, setMedRep] = useState('')
  const [medReps, setMedReps] = useState([])
  const [comment, setComment] = useState('')
  const [evidenceFile, setEvidenceFile] = useState(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [showClientList, setShowClientList] = useState(false)

  // All claims
  const [allClaims, setAllClaims] = useState([])
  const [profilesMap, setProfilesMap] = useState({})

  useEffect(() => {
    getProfile()
  }, [])

  useEffect(() => {
    if (eliteGroup) {
      fetchAllClients()
      fetchMedReps()
    }
  }, [eliteGroup])

  useEffect(() => {
    if (selectedClient) {
      fetchProducts()
    } else {
      setProducts([])
      setSelectedProduct('')
    }
  }, [selectedClient])

  const getProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (error || !data || !data.is_approved) {
      await supabase.auth.signOut()
      router.push('/login')
      return
    }

    setProfile(data)
    setLoading(false)
    fetchAllClaims()
  }

  const fetchAllClaims = async () => {
    const { data: claimsData, error } = await supabase
      .from('claims')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !claimsData) return

    const userIds = [...new Set(claimsData.map(c => c.user_id).filter(Boolean))]

    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)

      const map = {}
      profilesData?.forEach(p => {
        map[p.id] = p
      })
      setProfilesMap(map)
    }

    setAllClaims(claimsData)
  }

  // Fetch ALL clients (handles Supabase 1000 row limit)
  const fetchAllClients = async () => {
    let allPartyNames = []
    let from = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('primary_allocations')
        .select('party_name')
        .eq('elite_group', eliteGroup)
        .range(from, from + pageSize - 1)

      if (error) {
        console.error(error)
        break
      }

      if (data && data.length > 0) {
        allPartyNames = [...allPartyNames, ...data.map(item => item.party_name)]
        from += pageSize
        hasMore = data.length === pageSize
      } else {
        hasMore = false
      }
    }

    const uniqueClients = [...new Set(allPartyNames.filter(Boolean))]
    uniqueClients.sort()
    setClients(uniqueClients)
  }

  const fetchMedReps = async () => {
    const { data, error } = await supabase
      .from('primary_allocations')
      .select('recommended_rep')
      .eq('elite_group', eliteGroup)

    if (!error && data) {
      const uniqueReps = [...new Set(
        data
          .map(item => item.recommended_rep)
          .filter(rep => rep && rep.trim() !== '' && rep.toUpperCase() !== 'OFFICE' && rep.toUpperCase() !== 'HEAD OFFICE')
      )]
      uniqueReps.sort()
      setMedReps(uniqueReps)
      setMedRep('')
    }
  }

  const fetchProducts = async () => {
    const { data, error } = await supabase
      .from('primary_allocations')
      .select('product_name, billed_qty')
      .eq('elite_group', eliteGroup)
      .eq('party_name', selectedClient)

    if (!error && data) {
      const productMap = {}
      data.forEach(item => {
        if (item.product_name) {
          if (!productMap[item.product_name]) {
            productMap[item.product_name] = 0
          }
          productMap[item.product_name] += Number(item.billed_qty) || 0
        }
      })

      const productList = Object.keys(productMap).map(name => ({
        name,
        total_qty: productMap[name]
      })).sort((a, b) => a.name.localeCompare(b.name))

      setProducts(productList)
    }
  }

  const handleSubmitClaim = async (e) => {
    e.preventDefault()
    if (!selectedClient || !selectedProduct || !claimedQty || !medRep) {
      setMessage('Please fill all required fields')
      return
    }

    setSubmitting(true)
    setMessage('Submitting claim...')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      let evidenceUrl = null

      if (evidenceFile) {
        const fileExt = evidenceFile.name.split('.').pop()
        const fileName = `${user.id}_${Date.now()}.${fileExt}`

        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(fileName, evidenceFile)

        if (uploadError) {
          setMessage('Error uploading evidence: ' + uploadError.message)
          setSubmitting(false)
          return
        }

        const { data: urlData } = supabase.storage
          .from('evidence')
          .getPublicUrl(fileName)

        evidenceUrl = urlData.publicUrl
      }

      const { error } = await supabase.from('claims').insert({
        user_id: user.id,
        elite_group: eliteGroup,
        party_name: selectedClient,
        product_name: selectedProduct,
        claimed_qty: Number(claimedQty),
        med_rep: medRep,
        comment: comment || null,
        evidence_url: evidenceUrl,
        status: 'pending'
      })

      if (error) {
        setMessage('Error: ' + error.message)
      } else {
        setMessage('Claim submitted successfully! Waiting for admin approval.')
        setSelectedClient('')
        setSelectedProduct('')
        setClaimedQty('')
        setMedRep('')
        setComment('')
        setEvidenceFile(null)
        setClientSearch('')
        fetchAllClaims()
      }
    } catch (err) {
      setMessage('Something went wrong: ' + err.message)
    }

    setSubmitting(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Filtered clients for the searchable dropdown
  const filteredClients = clients.filter(client =>
    client.toLowerCase().includes(clientSearch.toLowerCase())
  )

  const groupedClaims = allClaims.reduce((acc, claim) => {
    const group = claim.elite_group || 'Unknown'
    if (!acc[group]) acc[group] = []
    acc[group].push(claim)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-800 text-lg font-medium">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6 text-gray-900">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manager Dashboard</h1>
            <p className="text-gray-700 font-medium">Welcome, {profile?.full_name}</p>
          </div>
          <button
            onClick={handleLogout}
            className="bg-red-600 text-white px-5 py-2 rounded hover:bg-red-700 font-medium"
          >
            Logout
          </button>
        </div>

        {/* Claim Form */}
        <div className="bg-white rounded-lg shadow p-6 mb-8 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-5">Submit New Claim</h2>

          <form onSubmit={handleSubmitClaim} className="space-y-4">
            {/* Elite Group */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Elite Group</label>
              <select
                value={eliteGroup}
                onChange={(e) => {
                  setEliteGroup(e.target.value)
                  setSelectedClient('')
                  setSelectedProduct('')
                  setClientSearch('')
                  setMedRep('')
                  setShowClientList(false)
                }}
                className="w-full border border-gray-400 px-3 py-2 rounded text-gray-900 bg-white"
              >
                <option value="Elite 1">Elite 1</option>
                <option value="Elite 2">Elite 2</option>
                <option value="Elite 3">Elite 3</option>
                <option value="Elite 4">Elite 4</option>
                <option value="Elite 5">Elite 5</option>
              </select>
            </div>

            {/* MedRep */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">MedRep Name *</label>
              <select
                value={medRep}
                onChange={(e) => setMedRep(e.target.value)}
                className="w-full border border-gray-400 px-3 py-2 rounded text-gray-900 bg-white"
                required
              >
                <option value="">-- Select MedRep --</option>
                {medReps.map((rep) => (
                  <option key={rep} value={rep}>{rep}</option>
                ))}
              </select>
              {medReps.length === 0 && (
                <p className="text-xs text-gray-600 mt-1">No MedReps found for this Elite Group</p>
              )}
            </div>

            {/* Smart Client Search / Select */}
            <div className="relative">
              <label className="block text-sm font-semibold text-gray-800 mb-1">Select Client *</label>
              
              <input
                type="text"
                value={selectedClient || clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value)
                  setSelectedClient('')
                  setShowClientList(true)
                }}
                onFocus={() => setShowClientList(true)}
                placeholder="Click or type to search client..."
                className="w-full border border-gray-400 px-3 py-2 rounded text-gray-900"
                required
              />

              {/* Dropdown List */}
              {showClientList && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-400 rounded shadow-lg max-h-60 overflow-y-auto">
                  {filteredClients.length === 0 ? (
                    <div className="p-3 text-gray-600 text-sm">No clients found</div>
                  ) : (
                    filteredClients.map((client) => (
                      <div
                        key={client}
                        onClick={() => {
                          setSelectedClient(client)
                          setClientSearch(client)
                          setShowClientList(false)
                        }}
                        className="px-3 py-2 hover:bg-blue-100 cursor-pointer text-gray-900 text-sm border-b border-gray-100"
                      >
                        {client}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Click outside to close */}
              {showClientList && (
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setShowClientList(false)}
                ></div>
              )}
            </div>

            {/* Product */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Select Product *</label>
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className="w-full border border-gray-400 px-3 py-2 rounded text-gray-900 bg-white"
                required
                disabled={!selectedClient}
              >
                <option value="">-- Select Product --</option>
                {products.map((product) => (
                  <option key={product.name} value={product.name}>
                    {product.name} (Available: {product.total_qty})
                  </option>
                ))}
              </select>
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Claimed Quantity *</label>
              <input
                type="number"
                value={claimedQty}
                onChange={(e) => setClaimedQty(e.target.value)}
                min="1"
                required
                className="w-full border border-gray-400 px-3 py-2 rounded text-gray-900"
                placeholder="Enter quantity"
              />
            </div>

            {/* Comment */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Comment / Destination</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows="3"
                className="w-full border border-gray-400 px-3 py-2 rounded text-gray-900"
                placeholder="Example: Claiming from Transwide to Matuu Level 5 Hospital"
              />
            </div>

            {/* Evidence */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Supporting Evidence (Image or PDF)</label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setEvidenceFile(e.target.files[0])}
                className="w-full border border-gray-400 p-2 rounded text-gray-900"
              />
              {evidenceFile && (
                <p className="text-sm text-gray-700 mt-1 font-medium">Selected: {evidenceFile.name}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white py-2.5 rounded hover:bg-blue-700 disabled:bg-blue-300 font-medium"
            >
              {submitting ? 'Submitting...' : 'Submit Claim'}
            </button>
          </form>

          {message && (
            <p className={`mt-4 text-center text-sm font-medium ${message.includes('Error') ? 'text-red-700' : 'text-green-700'}`}>
              {message}
            </p>
          )}
        </div>

        {/* All Claims Grouped by Elite */}
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-5">All Claims (Grouped by Elite)</h2>

          {allClaims.length === 0 ? (
            <p className="text-gray-700">No claims submitted yet.</p>
          ) : (
            <div className="space-y-8">
              {Object.keys(groupedClaims).sort().map((group) => (
                <div key={group}>
                  <h3 className="text-lg font-bold bg-blue-100 text-blue-900 p-3 rounded mb-3 border border-blue-200">
                    {group} — {groupedClaims[group].length} claim(s)
                  </h3>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-gray-300">
                      <thead className="bg-gray-200 text-gray-900">
                        <tr>
                          <th className="border border-gray-300 p-2 text-left font-semibold">Date</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold">Submitted By</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold">MedRep</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold">Client</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold">Product</th>
                          <th className="border border-gray-300 p-2 text-right font-semibold">Qty</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold">Comment</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold">Status</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold">Evidence</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-900">
                        {groupedClaims[group].map((claim) => (
                          <tr key={claim.id} className="hover:bg-gray-50">
                            <td className="border border-gray-300 p-2">
                              {new Date(claim.created_at).toLocaleDateString()}
                            </td>
                            <td className="border border-gray-300 p-2 font-medium">
                              {profilesMap[claim.user_id]?.full_name || 'Unknown'}
                            </td>
                            <td className="border border-gray-300 p-2">{claim.med_rep}</td>
                            <td className="border border-gray-300 p-2">{claim.party_name}</td>
                            <td className="border border-gray-300 p-2">{claim.product_name}</td>
                            <td className="border border-gray-300 p-2 text-right font-medium">{claim.claimed_qty}</td>
                            <td className="border border-gray-300 p-2 max-w-xs truncate" title={claim.comment}>
                              {claim.comment || '-'}
                            </td>
                            <td className="border border-gray-300 p-2">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                claim.status === 'approved' ? 'bg-green-200 text-green-900' :
                                claim.status === 'rejected' ? 'bg-red-200 text-red-900' :
                                'bg-yellow-200 text-yellow-900'
                              }`}>
                                {claim.status}
                              </span>
                              {claim.status === 'rejected' && claim.rejection_reason && (
                                <p className="text-xs text-red-700 mt-1 font-medium" title={claim.rejection_reason}>
                                  Reason: {claim.rejection_reason}
                                </p>
                              )}
                            </td>
                            <td className="border border-gray-300 p-2">
                              {claim.evidence_url ? (
                                <a
                                  href={claim.evidence_url}
                                  target="_blank"
                                  className="text-blue-700 hover:underline font-medium"
                                >
                                  View
                                </a>
                              ) : (
                                <span className="text-gray-600">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}