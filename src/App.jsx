import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import './App.css'
import multicallAbi from './abi/multicall.json'
import defaultStudentAbi from './abi/studentReg.json'

const MULTICALL_CONTRACT_ADDRESS = '0xc61aF69EF4A850604b2F22332E68ac9E4881E47f'

const EMPTY_FORM = {
  name: '',
  course: '',
  age: '',
  studentId: '',
}

const asLowerAddress = (value) => (value ? value.toLowerCase() : '')

const getMethodName = (contract, candidates) => {
  const functions = contract?.interface?.functions || {}
  const names = Object.keys(functions)
  return candidates.find((candidate) => names.includes(candidate)) || null
}

const normalizeStudent = (student, fallbackAddress = '') => {
  if (!student) return null

  if (typeof student === 'object' && !Array.isArray(student)) {
    return {
      studentAddress: student.studentAddress || student.student || student.wallet || fallbackAddress || '',
      name: student.name || '',
      course: student.course || '',
      age: Number(student.age ?? 0),
      studentId: student.studentId || student.studentID || '',
      isActive: typeof student.isActive === 'boolean' ? student.isActive : Boolean(student.active),
    }
  }

  const values = Array.isArray(student) ? student : Object.values(student)

  if (values.length === 3) {
    return {
      studentAddress: fallbackAddress || '',
      name: values[0] || '',
      course: values[2] || '',
      age: Number(values[1] ?? 0),
      studentId: '',
      isActive: true,
    }
  }

  if (values.length >= 6) {
    return {
      studentAddress: values[0] || fallbackAddress || '',
      name: values[1] || '',
      course: values[2] || '',
      age: Number(values[3] ?? 0),
      studentId: values[4] || '',
      isActive: typeof values[5] === 'boolean' ? values[5] : Boolean(values[5]),
    }
  }

  return {
    studentAddress: fallbackAddress || '',
    name: values[0] || '',
    course: values[1] || '',
    age: Number(values[2] ?? 0),
    studentId: '',
    isActive: true,
  }
}

function App() {
  const [walletAddress, setWalletAddress] = useState('')
  const [studentContractAddress, setStudentContractAddress] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [status, setStatus] = useState({ type: 'info', text: 'Connect your wallet to continue.' })
  const [currentUser, setCurrentUser] = useState(null)
  const [allStudents, setAllStudents] = useState([])
  const [loading, setLoading] = useState({ register: false, current: false, all: false })

  const provider = useMemo(() => {
    if (typeof window === 'undefined' || !window.ethereum) return null
    return new ethers.BrowserProvider(window.ethereum)
  }, [])

  useEffect(() => {
    const loadAccount = async () => {
      if (!provider) return

      try {
        const [account] = await provider.listAccounts()
        if (account) {
          setWalletAddress(asLowerAddress(account))
        }
      } catch (error) {
        console.error('Could not load accounts', error)
      }
    }

    loadAccount()
  }, [provider])

  const getStudentContract = async (withSigner = false) => {
    if (!studentContractAddress) {
      throw new Error('Enter the student contract address first.')
    }

    const abi = defaultStudentAbi
    const signerOrProvider = withSigner ? await provider.getSigner() : provider
    return new ethers.Contract(studentContractAddress, abi, signerOrProvider)
  }

  const connectWallet = async () => {
    if (!window.ethereum) {
      setStatus({ type: 'error', text: 'MetaMask is not installed in this browser.' })
      return
    }

    try {
      const accounts = await provider.send('eth_requestAccounts', [])
      const connectedWallet = asLowerAddress(accounts[0])
      setWalletAddress(connectedWallet)
      setStatus({ type: 'success', text: `Wallet connected: ${connectedWallet}` })
    } catch (error) {
      setStatus({ type: 'error', text: error.message || 'Wallet connection failed.' })
    }
  }

  const fetchLoggedInUser = async () => {
    if (!provider || !walletAddress || !studentContractAddress) {
      setStatus({ type: 'error', text: 'Connect a wallet and add the student contract address.' })
      return
    }

    setLoading((previous) => ({ ...previous, current: true }))

    try {
      const contract = await getStudentContract(false)
      const methodName = getMethodName(contract, ['getStudent', 'getStudentDetails', 'studentInfo', 'getStudentByAddress'])

      if (!methodName) {
        throw new Error('This ABI does not include a user lookup method. Add an ABI that includes getStudent-like calls.')
      }

      const result = await contract[methodName](walletAddress)
      const formatted = normalizeStudent(result, walletAddress)
      setCurrentUser(formatted)
      setStatus({ type: 'success', text: 'Logged-in student details loaded.' })
    } catch (error) {
      console.error(error)
      setCurrentUser(null)
      setStatus({ type: 'error', text: error.message || 'Unable to fetch logged-in user.' })
    } finally {
      setLoading((previous) => ({ ...previous, current: false }))
    }
  }

  const fetchAllStudents = async () => {
    if (!provider || !studentContractAddress) {
      setStatus({ type: 'error', text: 'Add the student contract address before fetching students.' })
      return
    }

    setLoading((previous) => ({ ...previous, all: true }))

    try {
      const studentContract = await getStudentContract(false)
      const totalMethodName = getMethodName(studentContract, ['totalStudents', 'getTotalStudents'])
      const indexMethodName = getMethodName(studentContract, ['getStudentByIndex', 'studentByIndex', 'getStudentAt', 'students'])
      const allMethodName = getMethodName(studentContract, ['getAllStudents', 'getStudents', 'allStudents'])

      if (totalMethodName && indexMethodName) {
        const total = await studentContract[totalMethodName]()
        const totalCount = Number(total)

        if (totalCount === 0) {
          setAllStudents([])
          setStatus({ type: 'success', text: 'No students are currently registered.' })
          return
        }

        const multicallContract = new ethers.Contract(MULTICALL_CONTRACT_ADDRESS, multicallAbi, provider)
        const calls = []

        for (let index = 0; index < totalCount; index += 1) {
          const callData = studentContract.interface.encodeFunctionData(indexMethodName, [index])
          calls.push({ target: studentContractAddress, callData })
        }

        const results = await multicallContract.tryAggregate(false, calls)
        const decodedStudents = results
          .filter((result) => result && result.success)
          .map((result) => {
            const decoded = studentContract.interface.decodeFunctionResult(indexMethodName, result.returnData)
            return normalizeStudent(decoded[0], '')
          })
          .filter(Boolean)

        setAllStudents(decodedStudents)
        setStatus({ type: 'success', text: `Loaded ${decodedStudents.length} registered students.` })
        return
      }

      if (allMethodName) {
        const rawList = await studentContract[allMethodName]()
        const students = Array.isArray(rawList) ? rawList.map((item) => normalizeStudent(item, '')) : []
        setAllStudents(students.filter(Boolean))
        setStatus({ type: 'success', text: `Loaded ${students.length} registered students.` })
        return
      }

      throw new Error('This ABI does not expose a list of students. Use an ABI that includes totalStudents/getStudentByIndex or getAllStudents.')
    } catch (error) {
      console.error(error)
      setAllStudents([])
      setStatus({ type: 'error', text: error.message || 'Unable to fetch all students with multicall.' })
    } finally {
      setLoading((previous) => ({ ...previous, all: false }))
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!studentContractAddress || !walletAddress) {
      setStatus({ type: 'error', text: 'Connect the wallet and enter the student contract address.' })
      return
    }

    setLoading((previous) => ({ ...previous, register: true }))

    try {
      const contract = await getStudentContract(true)
      const registerMethodName = getMethodName(contract, ['registerStudent', 'register'])

      if (!registerMethodName) {
        throw new Error('This ABI does not include a registration method.')
      }

      const args =
        registerMethodName === 'register'
          ? [form.name, Number(form.age), form.course]
          : [form.name, form.course, Number(form.age), form.studentId]

      const tx = await contract[registerMethodName](...args)
      setStatus({ type: 'info', text: 'Transaction sent. Waiting for confirmation...' })
      await tx.wait()
      setForm(EMPTY_FORM)
      setStatus({ type: 'success', text: 'Student registered successfully.' })
      await fetchLoggedInUser()
      await fetchAllStudents()
    } catch (error) {
      console.error(error)
      setStatus({ type: 'error', text: error.message || 'Student registration failed.' })
    } finally {
      setLoading((previous) => ({ ...previous, register: false }))
    }
  }

  useEffect(() => {
    if (walletAddress && studentContractAddress) {
      fetchLoggedInUser()
      fetchAllStudents()
    }
  }, [walletAddress, studentContractAddress])

  return (
    <main className="page-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Sepolia multicall enabled</p>
          <h1>Student Registration Dashboard</h1>
        </div>
      </section>

      <div className={`alert alert-${status.type}`}>{status.text}</div>

      <section className="config-panel">
        <label>
          Student Contract Address
          <input
            type="text"
            value={studentContractAddress}
            onChange={(event) => setStudentContractAddress(event.target.value.trim())}
            placeholder="0x..."
          />
        </label>

        <button type="button" className="primary-button" onClick={connectWallet}>
          {walletAddress ? `Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Connect MetaMask'}
        </button>
      </section>

      <section className="content-grid">
        <div className="panel">
          <h2>Register Student</h2>

          <form onSubmit={handleSubmit} className="student-form">
            <label>
              Name
              <input
                type="text"
                value={form.name}
                onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
                required
              />
            </label>

            <label>
              Course
              <input
                type="text"
                value={form.course}
                onChange={(event) => setForm((previous) => ({ ...previous, course: event.target.value }))}
                required
              />
            </label>

            <label>
              Age
              <input
                type="number"
                min="1"
                value={form.age}
                onChange={(event) => setForm((previous) => ({ ...previous, age: event.target.value }))}
                required
              />
            </label>

            <label>
              Student ID
              <input
                type="text"
                value={form.studentId}
                onChange={(event) => setForm((previous) => ({ ...previous, studentId: event.target.value }))}
                required
              />
            </label>

            <button type="submit" className="primary-button" disabled={loading.register}>
              {loading.register ? 'Registering...' : 'Register Student'}
            </button>
          </form>
        </div>

        <div className="panel">
          <h2>Logged In User</h2>

          {loading.current ? (
            <p>Loading student details...</p>
          ) : currentUser ? (
            <div className="detail-card">
              <p><strong>Name:</strong> {currentUser.name}</p>
              <p><strong>Course:</strong> {currentUser.course}</p>
              <p><strong>Age:</strong> {currentUser.age}</p>
              <p><strong>Student ID:</strong> {currentUser.studentId}</p>
              <p><strong>Wallet:</strong> {currentUser.studentAddress}</p>
              <p><strong>Status:</strong> {currentUser.isActive ? 'Active' : 'Inactive'}</p>
            </div>
          ) : (
            <p>Connect a wallet and add your student contract to view the current student.</p>
          )}
        </div>
      </section>

      <section className="panel all-students-panel">
        <div className="section-heading">
          <h2>All Registered Students</h2>
          <button type="button" className="secondary-button" onClick={fetchAllStudents} disabled={loading.all}>
            {loading.all ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {allStudents.length > 0 ? (
          <div className="student-list">
            {allStudents.map((student, index) => (
              <div key={`${student.studentAddress}-${index}`} className="student-item">
                <p><strong>{student.name}</strong></p>
                <p>Course: {student.course}</p>
                <p>Age: {student.age}</p>
                <p>Student ID: {student.studentId}</p>
                <p>Wallet: {student.studentAddress}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>No students found yet.</p>
        )}
      </section>
    </main>
  )
}

export default App
