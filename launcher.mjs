// Launches server.js as a fully detached process that survives parent exit
import { spawn } from 'child_process'
import { openSync } from 'fs'

const logOut = openSync('C:/Users/Chang/empirehacks-2026/backend/backend.log', 'a')
const logErr = openSync('C:/Users/Chang/empirehacks-2026/backend/backend-err.log', 'a')

const child = spawn(process.execPath, ['server.js'], {
  cwd: 'C:/Users/Chang/empirehacks-2026/backend',
  detached: true,
  stdio: ['ignore', logOut, logErr]
})

child.unref()
console.log('Launched detached server with PID:', child.pid)
process.exit(0)
