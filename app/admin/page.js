'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

export default function AdminPage() {
  const router = useRouter()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [eliteGroup, setEliteGroup] = useState('Elite 1')

  const [viewGroup, setViewGroup] = useState('Elite 1')
  const [allocations, setAllocations] = useState([])
  const [loadingData, setLoadingData] = useState(false)

  const [claims, setClaims] = useState([])
  const [loadingClaims, setLoadingClaims] = useState(false)
  const [profilesMap, setProfilesMap] = useState({})
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')

  useEffect(() => {
    checkAdmin()
    fetchPendingUsers()
    fetchClaims()
  }, [])

  const checkAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      router.push('/dashboard')
    }
  }

  const fetchPendingUsers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_approved', false)
      .order('created_at', { ascending: false })

    if (!error) setUsers(data || [])
    setLoading(false)
  }

  const fetchClaims = async () => {
    setLoadingClaims(true)
    const { data: claimsData, error } = await supabase
      .from('claims')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setLoadingClaims(false)
      return
    }

    const userIds = [...new Set(claimsData.map(c => c.user_id).filter(Boolean))]
    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)

      const map = {}
      profilesData?.forEach(p => { map[p.id] = p })
      setProfilesMap(map)
    }

    setClaims(claimsData || [])
    setLoadingClaims(false)
  }

  const approveUser = async (userId) => {
    const { error } = await supabase
      .from('profiles')
      .update({ is_approved: true })
      .eq('id', userId)

    if (error) setMessage(error.message)
    else {
      setMessage('User approved successfully!')
      fetchPendingUsers()
    }
  }

  const updateClaimStatus = async (claimId, status, reason = null) => {
    const updateData = { status }
    if (status === 'rejected' && reason) updateData.rejection_reason = reason

    const { error } = await supabase
      .from('claims')
      .update(updateData)
      .eq('id', claimId)

    if (error) setMessage(error.message)
    else {
      setMessage(`Claim ${status} successfully!`)
      setRejectingId(null)
      setRejectionReason('')
      fetchClaims()
    }
  }

  const downloadApprovedClaimsByGroup = (group) => {
    const approved = claims.filter(c => c.status === 'approved' && c.elite_group === group)

    if (approved.length === 0) {
      setMessage(`No approved claims found for ${group}`)
      return
    }

    const products = [...new Set(approved.map(c => c.product_name))].sort()
    const uniqueKeys = {}

    approved.forEach(claim => {
      const key = `${claim.party_name}|||${claim.med_rep}`
      if (!uniqueKeys[key]) {
        uniqueKeys[key] = {
          distributor: claim.party_name,
          medRep: claim.med_rep,
          products: {}
        }
      }
      uniqueKeys[key].products[claim.product_name] =
        (uniqueKeys[key].products[claim.product_name] || 0) + Number(claim.claimed_qty)
    })

    const dataRows = Object.values(uniqueKeys).map(item => {
      const row = {
        'DISTRIBUTOR': item.distributor,
        'REP NAME': item.medRep
      }
      products.forEach(product => {
        row[product] = item.products[product] || ''
      })
      return row
    })

    dataRows.sort((a, b) => {
      if (a.DISTRIBUTOR < b.DISTRIBUTOR) return -1
      if (a.DISTRIBUTOR > b.DISTRIBUTOR) return 1
      if (a['REP NAME'] < b['REP NAME']) return -1
      if (a['REP NAME'] > b['REP NAME']) return 1
      return 0
    })

    const header = ['DISTRIBUTOR', 'REP NAME', ...products]
    const aoa = [
      [`${group.toUpperCase()} CLAIMS TEMPLATE`],
      ['Instructions: Fill only the Claimed Qty column for each Rep'],
      [],
      header,
    ]

    dataRows.forEach(row => {
      const line = [row['DISTRIBUTOR'], row['REP NAME']]
      products.forEach(p => line.push(row[p] || ''))
      aoa.push(line)
    })

    const worksheet = XLSX.utils.aoa_to_sheet(aoa)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, `${group} Claims`)
    XLSX.writeFile(workbook, `${group}_Claims_Template_${new Date().toISOString().slice(0, 10)}.xlsx`)
    setMessage(`Downloaded ${group} template with ${approved.length} approved claims`)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setUploading(true)
    setMessage('Reading Excel file...')

    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const jsonData = XLSX.utils.sheet_to_json(sheet)

      if (jsonData.length === 0) {
        setMessage('Excel file is empty')
        setUploading(false)
        return
      }

      const rows = jsonData.map((row) => {
        let dateValue = null
        if (row['Date']) {
          if (typeof row['Date'] === 'number') {
            const excelDate = XLSX.SSF.parse_date_code(row['Date'])
            if (excelDate) {
              dateValue = `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`
            }
          } else {
            dateValue = row['Date']
          }
        }

        return {
          elite_group: eliteGroup,
          date: dateValue,
          voucher_no: row['Voucher No'] ? String(row['Voucher No']) : null,
          party_name: row['Party Name'] || null,
          sales_man: row['Sales Man'] || null,
          product_name: row['Product Name'] || null,
          actual_qty: Number(row['Actual Qty']) || 0,
          billed_qty: Number(row['Billed Qty']) || 0,
          rate: Number(row['Rate']) || 0,
          total_amount: Number(row['Total Amount']) || 0,
          suggested_rep: row['Suggested_Rep'] || null,
          status: row['Status'] || null,
          recommended_rep: row['Recommended_Rep'] || null,
        }
      })

      const { error } = await supabase.from('primary_allocations').insert(rows)

      if (error) setMessage('Error uploading: ' + error.message)
      else setMessage(`Successfully uploaded ${rows.length} rows for ${eliteGroup}`)
    } catch (err) {
      setMessage('Failed to read file: ' + err.message)
    }

    setUploading(false)
  }

  const fetchAllocations = async () => {
    setLoadingData(true)
    const { data, error } = await supabase
      .from('primary_allocations')
      .select('*')
      .eq('elite_group', viewGroup)
      .order('party_name')
      
    if (!error) setAllocations(data || [])
    setLoadingData(false)
  }

  const groupedClaims = claims.reduce((acc, claim) => {
    const group = claim.elite_group || 'Unknown'
    if (!acc[group]) acc[group] = []
    acc[group].push(claim)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-800 text-lg">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6 text-gray-900">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <button
            onClick={handleLogout}
            className="bg-red-600 text-white px-5 py-2 rounded hover:bg-red-700 font-medium"
          >
            Logout
          </button>
        </div>

        {message && (
          <div className="mb-4 p-3 bg-green-100 text-green-800 rounded font-medium border border-green-300">
            {message}
          </div>
        )}

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-8 border">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Upload Primary Allocation</h2>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-800 mb-1">Select Elite Group</label>
            <select
              value={eliteGroup}
              onChange={(e) => setEliteGroup(e.target.value)}
              className="border border-gray-400 px-3 py-2 rounded text-gray-900 bg-white"
            >
              <option value="Elite 1">Elite 1</option>
              <option value="Elite 2">Elite 2</option>
              <option value="Elite 3">Elite 3</option>
              <option value="Elite 4">Elite 4</option>
              <option value="Elite 5">Elite 5</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Choose Excel File</label>
            <input
              type="file"
              accept=".xlsx, .xls"
              onChange={handleFileUpload}
              disabled={uploading}
              className="border border-gray-400 p-2 rounded w-full text-gray-900"
            />
          </div>

          {uploading && <p className="mt-3 text-blue-700 font-medium">Uploading... Please wait</p>}
        </div>

        {/* Claims Approval */}
        <div className="bg-white rounded-lg shadow p-6 mb-8 border">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
            <h2 className="text-xl font-bold text-gray-900">Claims Approval (Grouped by Elite)</h2>

            <div className="flex flex-wrap gap-2">
              {['Elite 1', 'Elite 2', 'Elite 3', 'Elite 4', 'Elite 5'].map((group) => (
                <button
                  key={group}
                  onClick={() => downloadApprovedClaimsByGroup(group)}
                  className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 font-medium"
                >
                  Download {group}
                </button>
              ))}
              <button
                onClick={fetchClaims}
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 font-medium"
              >
                Refresh
              </button>
            </div>
          </div>

          {loadingClaims ? (
            <p className="text-gray-800">Loading claims...</p>
          ) : claims.length === 0 ? (
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
                          <th className="border border-gray-300 p-2 text-left font-semibold">Evidence</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold">Status</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold">Action</th>
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
                              {claim.evidence_url ? (
                                <a href={claim.evidence_url} target="_blank" className="text-blue-700 underline font-medium">
                                  View
                                </a>
                              ) : '-'}
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
                              {claim.status === 'pending' && (
                                <div className="space-y-2">
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => updateClaimStatus(claim.id, 'approved')}
                                      className="bg-green-600 text-white px-2 py-1 rounded text-xs hover:bg-green-700 font-medium"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => setRejectingId(claim.id)}
                                      className="bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700 font-medium"
                                    >
                                      Reject
                                    </button>
                                  </div>

                                  {rejectingId === claim.id && (
                                    <div className="mt-2">
                                      <textarea
                                        value={rejectionReason}
                                        onChange={(e) => setRejectionReason(e.target.value)}
                                        placeholder="Reason for rejection..."
                                        className="w-full border border-gray-400 p-1 text-xs rounded text-gray-900"
                                        rows="2"
                                      />
                                      <div className="flex gap-2 mt-1">
                                        <button
                                          onClick={() => updateClaimStatus(claim.id, 'rejected', rejectionReason)}
                                          className="bg-red-600 text-white px-2 py-1 rounded text-xs font-medium"
                                        >
                                          Confirm Reject
                                        </button>
                                        <button
                                          onClick={() => {
                                            setRejectingId(null)
                                            setRejectionReason('')
                                          }}
                                          className="bg-gray-500 text-white px-2 py-1 rounded text-xs font-medium"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
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

        {/* View Uploaded Data */}
        <div className="bg-white rounded-lg shadow p-6 mb-8 border">
          <h2 className="text-xl font-bold text-gray-900 mb-4">View Uploaded Data</h2>

          <div className="flex gap-4 mb-4 items-end">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Elite Group</label>
              <select
                value={viewGroup}
                onChange={(e) => setViewGroup(e.target.value)}
                className="border border-gray-400 px-3 py-2 rounded text-gray-900"
              >
                <option value="Elite 1">Elite 1</option>
                <option value="Elite 2">Elite 2</option>
                <option value="Elite 3">Elite 3</option>
                <option value="Elite 4">Elite 4</option>
                <option value="Elite 5">Elite 5</option>
              </select>
            </div>
            <button
              onClick={fetchAllocations}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-medium"
            >
              Load Data
            </button>
          </div>

          {loadingData ? (
            <p className="text-gray-800">Loading data...</p>
          ) : allocations.length === 0 ? (
            <p className="text-gray-700">No data loaded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-300">
                <thead className="bg-gray-200 text-gray-900">
                  <tr>
                    <th className="border border-gray-300 p-2 text-left font-semibold">Party Name</th>
                    <th className="border border-gray-300 p-2 text-left font-semibold">Product Name</th>
                    <th className="border border-gray-300 p-2 text-right font-semibold">Billed Qty</th>
                    <th className="border border-gray-300 p-2 text-left font-semibold">Recommended Rep</th>
                    <th className="border border-gray-300 p-2 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="text-gray-900">
                  {allocations.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="border border-gray-300 p-2">{row.party_name}</td>
                      <td className="border border-gray-300 p-2">{row.product_name}</td>
                      <td className="border border-gray-300 p-2 text-right">{row.billed_qty}</td>
                      <td className="border border-gray-300 p-2">{row.recommended_rep}</td>
                      <td className="border border-gray-300 p-2">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-sm text-gray-700">Showing first 100 rows only</p>
            </div>
          )}
        </div>

        {/* Pending User Approvals */}
        <div className="bg-white rounded-lg shadow p-6 border">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Pending User Approvals</h2>

          {users.length === 0 ? (
            <p className="text-gray-700">No pending users</p>
          ) : (
            <div className="space-y-4">
              {users.map((user) => (
                <div key={user.id} className="flex justify-between items-center border-b border-gray-300 pb-3">
                  <div>
                    <p className="font-semibold text-gray-900">{user.full_name || 'No name'}</p>
                    <p className="text-sm text-gray-700">{user.email}</p>
                  </div>
                  <button
                    onClick={() => approveUser(user.id)}
                    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 font-medium"
                  >
                    Approve
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}