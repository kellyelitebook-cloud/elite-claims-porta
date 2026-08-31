'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function RegisterPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('manager')
  const [medRepName, setMedRepName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const medReps = [
    'BILLY', 'JACKY', 'JULIE', 'JOHN', 'PATRICIA', 'PURITY',
    'JANE', 'COLLINS', 'CHEPKOECH', 'OWINO', 'DIANA', 'VIRGINIA',
    'EUNICE', 'WINROSE', 'WINNIE', 'FIRDOUS', 'ALICE', 'MUSINE'
  ]

  const handleRegister = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    if (role === 'salesman' && !medRepName) {
      setMessage('Please select your MedRep name')
      setLoading(false)
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role,
          med_rep_name: role === 'salesman' ? medRepName : null
        },
      },
    })

    if (error) {
      setMessage(error.message)
    } else {
      if (data.user) {
        await supabase
          .from('profiles')
          .update({
            full_name: fullName,
            role,
            med_rep_name: role === 'salesman' ? medRepName : null
          })
          .eq('id', data.user.id)
      }

      setMessage('Registration successful! Please wait for admin approval before logging in.')
      setFullName('')
      setEmail('')
      setPassword('')
      setRole('manager')
      setMedRepName('')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md border border-gray-200">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Account</h1>
          <p className="text-gray-600">Join the Elite Claims Portal</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full border border-gray-300 px-4 py-2.5 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your full name"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              I am a
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full border border-gray-300 px-4 py-2.5 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="manager">Manager</option>
              <option value="salesman">Salesman / MedRep</option>
            </select>
          </div>

          {role === 'salesman' && (
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                My MedRep Name
              </label>
              <select
                value={medRepName}
                onChange={(e) => setMedRepName(e.target.value)}
                required
                className="w-full border border-gray-300 px-4 py-2.5 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">-- Select your name --</option>
                {medReps.map((rep) => (
                  <option key={rep} value={rep}>{rep}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-gray-300 px-4 py-2.5 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full border border-gray-300 px-4 py-2.5 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Minimum 6 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition font-medium disabled:bg-blue-400"
          >
            {loading ? 'Creating account...' : 'Register'}
          </button>
        </form>

        {message && (
          <p className={`mt-4 text-center text-sm font-medium ${
            message.includes('successful') ? 'text-green-600' : 'text-red-600'
          }`}>
            {message}
          </p>
        )}

        <p className="mt-6 text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-600 font-medium hover:underline">
            Login here
          </Link>
        </p>
      </div>
    </div>
  )
}