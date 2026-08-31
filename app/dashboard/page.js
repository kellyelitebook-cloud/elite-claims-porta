'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [eliteGroup, setEliteGroup] = useState('Elite 1')
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState('')
  const [products, setProducts] = useState([])
  const [medReps, setMedReps] = useState([])
  const [evidenceFile, setEvidenceFile] = useState(null)
  const [message, setMessage] = useState('')
  const [reviewMessage, setReviewMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [showClientList, setShowClientList] = useState(false)
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')

  const emptyLine = () => ({
    id: Date.now() + Math.random(),
    medRep: '',
    product: '',
    destination: '',
    qty: ''
  })

  const [claimLines, setClaimLines] = useState([emptyLine()])
  const [allClaims, setAllClaims] = useState([])
  const [profilesMap, setProfilesMap] = useState({})

  const isSalesman = profile?.role === 'salesman'
  const isManager = profile?.role === 'manager' || profile?.role === 'rep'

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
    if (selectedClient) fetchProducts()
    else setProducts([])
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
        .select('id, full_name, role')
        .in('id', userIds)

      const map = {}
      profilesData?.forEach(p => { map[p.id] = p })
      setProfilesMap(map)
    }

    setAllClaims(claimsData)
  }

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

      if (error) break

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
          productMap[item.product_name] = (productMap[item.product_name] || 0) + (Number(item.billed_qty) || 0)
        }
      })
      const productList = Object.keys(productMap).map(name => ({
        name,
        total_qty: productMap[name]
      })).sort((a, b) => a.name.localeCompare(b.name))
      setProducts(productList)
    }
  }

  const updateLine = (id, field, value) => {
    setClaimLines(prev => prev.map(line => (
      line.id === id ? { ...line, [field]: value } : line
    )))
  }

  const addLine = () => setClaimLines(prev => [...prev, emptyLine()])
  const removeLine = (id) => setClaimLines(prev => prev.length === 1 ? prev : prev.filter(line => line.id !== id))

  const handleSubmitClaim = async (e) => {
    e.preventDefault()

    if (!selectedClient) {
      setMessage('Please select a client')
      return
    }
    if (!evidenceFile) {
      setMessage('Evidence is required')
      return
    }

    const validLines = claimLines.filter(line =>
      line.medRep && line.product && line.qty && Number(line.qty) > 0
    )

    if (validLines.length === 0) {
      setMessage('Please add at least one complete claim line')
      return
    }

    setSubmitting(true)
    setMessage('Submitting claims...')

    try {
      const { data: { user } } = await supabase.auth.getUser()
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

      const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(fileName)
      const evidenceUrl = urlData.publicUrl
      const nextStatus = isSalesman ? 'pending_manager' : 'pending_admin'

      const rows = validLines.map(line => ({
        user_id: user.id,
        elite_group: eliteGroup,
        party_name: selectedClient,
        product_name: line.product,
        claimed_qty: Number(line.qty),
        med_rep: line.medRep,
        comment: line.destination || null,
        evidence_url: evidenceUrl,
        status: nextStatus
      }))

      const { error } = await supabase.from('claims').insert(rows)

      if (error) {
        setMessage('Error: ' + error.message)
      } else {
        setMessage(
          isSalesman
            ? `${rows.length} claim(s) submitted. Waiting for manager review.`
            : `${rows.length} claim(s) submitted. Waiting for admin approval.`
        )
        setSelectedClient('')
        setClientSearch('')
        setEvidenceFile(null)
        setClaimLines([emptyLine()])
        fetchAllClaims()
      }
    } catch (err) {
      setMessage('Something went wrong: ' + err.message)
    }

    setSubmitting(false)
  }

  const reviewClaim = async (claimId, status, reason = null) => {
    const updateData = { status }
    if (status === 'rejected' && reason) updateData.rejection_reason = reason

    const { error } = await supabase.from('claims').update(updateData).eq('id', claimId)

    if (error) setReviewMessage(error.message)
    else {
      setReviewMessage(status === 'pending_admin' ? 'Sent to admin' : 'Claim rejected')
      setRejectingId(null)
      setRejectionReason('')
      fetchAllClaims()
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const statusLabel = (status) => {
    if (status === 'pending_manager') return 'Waiting Manager'
    if (status === 'pending_admin' || status === 'pending') return 'Waiting Admin'
    return status
  }

  const filteredClients = clients.filter(client =>
    client.toLowerCase().includes(clientSearch.toLowerCase())
  )

  const visibleClaims = isSalesman
    ? allClaims.filter(c => c.user_id === profile?.id)
    : allClaims

  const pendingManagerClaims = allClaims.filter(c => c.status === 'pending_manager')

  const groupedClaims = visibleClaims.reduce((acc, claim) => {
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
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isSalesman ? 'Salesman Dashboard' : 'Manager Dashboard'}
            </h1>
            <p className="text-gray-700 font-medium">Welcome, {profile?.full_name}</p>
          </div>
          <button onClick={handleLogout} className="bg-red-600 text-white px-5 py-2 rounded hover:bg-red-700 font-medium">
            Logout
          </button>
        </div>

        {isManager && (
          <div className="bg-white rounded-lg shadow p-6 mb-8 border border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Review Salesman Claims</h2>
            {reviewMessage && <p className="mb-3 text-sm font-medium text-green-700">{reviewMessage}</p>}
            {pendingManagerClaims.length === 0 ? (
              <p className="text-gray-700">No salesman claims waiting for review.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-gray-300">
                  <thead className="bg-gray-200">
                    <tr>
                      <th className="border p-2 text-left">Date</th>
                      <th className="border p-2 text-left">Submitted By</th>
                      <th className="border p-2 text-left">MedRep</th>
                      <th className="border p-2 text-left">Client</th>
                      <th className="border p-2 text-left">Product</th>
                      <th className="border p-2 text-right">Qty</th>
                      <th className="border p-2 text-left">Destination</th>
                      <th className="border p-2 text-left">Evidence</th>
                      <th className="border p-2 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingManagerClaims.map((claim) => (
                      <tr key={claim.id}>
                        <td className="border p-2">{new Date(claim.created_at).toLocaleDateString()}</td>
                        <td className="border p-2">{profilesMap[claim.user_id]?.full_name || 'Unknown'}</td>
                        <td className="border p-2">{claim.med_rep}</td>
                        <td className="border p-2">{claim.party_name}</td>
                        <td className="border p-2">{claim.product_name}</td>
                        <td className="border p-2 text-right">{claim.claimed_qty}</td>
                        <td className="border p-2">{claim.comment || '-'}</td>
                        <td className="border p-2">
                          {claim.evidence_url ? <a href={claim.evidence_url} target="_blank" className="text-blue-700 underline">View</a> : '-'}
                        </td>
                        <td className="border p-2">
                          <div className="flex gap-2 mb-2">
                            <button onClick={() => reviewClaim(claim.id, 'pending_admin')} className="bg-green-600 text-white px-2 py-1 rounded text-xs">Approve to Admin</button>
                            <button onClick={() => setRejectingId(claim.id)} className="bg-red-600 text-white px-2 py-1 rounded text-xs">Reject</button>
                          </div>
                          {rejectingId === claim.id && (
                            <div>
                              <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} className="w-full border p-1 text-xs rounded" rows="2" placeholder="Reason" />
                              <button onClick={() => reviewClaim(claim.id, 'rejected', rejectionReason)} className="bg-red-600 text-white px-2 py-1 rounded text-xs mt-1">Confirm Reject</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 mb-8 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Submit Claims Batch</h2>
          <p className="text-sm text-gray-700 mb-5">
            {isSalesman
              ? 'Pick the MedRep name from the Excel data. Example: TONNY ELD or TONNY KSM.'
              : 'Use one evidence for many lines. Your claims go directly to admin.'}
          </p>

          <form onSubmit={handleSubmitClaim} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Elite Group</label>
              <select
                value={eliteGroup}
                onChange={(e) => {
                  setEliteGroup(e.target.value)
                  setSelectedClient('')
                  setClientSearch('')
                  setShowClientList(false)
                  setClaimLines([emptyLine()])
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
              {showClientList && <div className="fixed inset-0 z-10" onClick={() => setShowClientList(false)}></div>}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Supporting Evidence *</label>
              <input type="file" accept="image/*,.pdf,.xlsx,.xls" onChange={(e) => setEvidenceFile(e.target.files[0])} className="w-full border border-gray-400 p-2 rounded text-gray-900" required />
              {evidenceFile && <p className="text-sm text-gray-700 mt-1 font-medium">Selected: {evidenceFile.name}</p>}
            </div>

            <div>
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-semibold text-gray-800">Claim Lines</label>
                <button type="button" onClick={addLine} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 font-medium">+ Add Line</button>
              </div>

              <div className="space-y-3">
                {claimLines.map((line, index) => (
                  <div key={line.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 border border-gray-300 rounded p-3 bg-gray-50">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold mb-1">MedRep *</label>
                      <select
                        value={line.medRep}
                        onChange={(e) => updateLine(line.id, 'medRep', e.target.value)}
                        className="w-full border border-gray-400 px-2 py-2 rounded text-gray-900 bg-white text-sm"
                        required
                      >
                        <option value="">Select</option>
                        {medReps.map((rep) => (
                          <option key={rep} value={rep}>{rep}</option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-4">
                      <label className="block text-xs font-semibold mb-1">Product *</label>
                      <select
                        value={line.product}
                        onChange={(e) => updateLine(line.id, 'product', e.target.value)}
                        className="w-full border border-gray-400 px-2 py-2 rounded text-gray-900 bg-white text-sm"
                        required
                        disabled={!selectedClient}
                      >
                        <option value="">Select</option>
                        {products.map((product) => (
                          <option key={product.name} value={product.name}>
                            {product.name} (Avail: {product.total_qty})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-xs font-semibold mb-1">Destination</label>
                      <input type="text" value={line.destination} onChange={(e) => updateLine(line.id, 'destination', e.target.value)} className="w-full border border-gray-400 px-2 py-2 rounded text-gray-900 text-sm" placeholder="Meru / Thika / Eldoret" />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold mb-1">Qty *</label>
                      <input type="number" min="1" value={line.qty} onChange={(e) => updateLine(line.id, 'qty', e.target.value)} className="w-full border border-gray-400 px-2 py-2 rounded text-gray-900 text-sm" required />
                    </div>

                    <div className="md:col-span-1 flex items-end">
                      <button type="button" onClick={() => removeLine(line.id)} className="w-full bg-red-600 text-white px-2 py-2 rounded text-sm hover:bg-red-700" disabled={claimLines.length === 1}>X</button>
                    </div>
                    <p className="md:col-span-12 text-xs text-gray-600">Line {index + 1}</p>
                  </div>
                ))}
              </div>
            </div>

            <button type="submit" disabled={submitting} className="w-full bg-blue-600 text-white py-2.5 rounded hover:bg-blue-700 disabled:bg-blue-300 font-medium">
              {submitting ? 'Submitting...' : 'Submit All Claim Lines'}
            </button>
          </form>

          {message && (
            <p className={`mt-4 text-center text-sm font-medium ${message.includes('Error') ? 'text-red-700' : 'text-green-700'}`}>
              {message}
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-5">
            {isSalesman ? 'My Claims' : 'All Claims (Grouped by Elite)'}
          </h2>
          {visibleClaims.length === 0 ? (
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
                            <td className="border border-gray-300 p-2">{new Date(claim.created_at).toLocaleDateString()}</td>
                            <td className="border border-gray-300 p-2 font-medium">{profilesMap[claim.user_id]?.full_name || 'Unknown'}</td>
                            <td className="border border-gray-300 p-2">{claim.med_rep}</td>
                            <td className="border border-gray-300 p-2">{claim.party_name}</td>
                            <td className="border border-gray-300 p-2">{claim.product_name}</td>
                            <td className="border border-gray-300 p-2 text-right font-medium">{claim.claimed_qty}</td>
                            <td className="border border-gray-300 p-2 max-w-xs truncate" title={claim.comment}>{claim.comment || '-'}</td>
                            <td className="border border-gray-300 p-2">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                claim.status === 'approved' ? 'bg-green-200 text-green-900' :
                                claim.status === 'rejected' ? 'bg-red-200 text-red-900' :
                                'bg-yellow-200 text-yellow-900'
                              }`}>
                                {statusLabel(claim.status)}
                              </span>
                            </td>
                            <td className="border border-gray-300 p-2">
                              {claim.evidence_url ? <a href={claim.evidence_url} target="_blank" className="text-blue-700 hover:underline font-medium">View</a> : '-'}
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