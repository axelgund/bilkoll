import { spawn } from 'child_process'

const PYTHON_CMDS = ['python', 'python3', 'py']

/**
 * Run a Python script and return its stdout as a string.
 * Tries python, python3, and py in order so it works on
 * Windows, Mac, and Linux regardless of how Python is installed.
 */
export function runPython(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let cmdIndex = 0

    function attempt() {
      if (cmdIndex >= PYTHON_CMDS.length) {
        reject(new Error('No Python interpreter found (tried python, python3, py)'))
        return
      }

      const cmd  = PYTHON_CMDS[cmdIndex++]
      let stdout = ''
      let stderr = ''
      let done   = false

      const proc = spawn(cmd, args)

      proc.stdout.on('data', d => { stdout += d.toString() })
      proc.stderr.on('data', d => { stderr += d.toString() })

      const timer = setTimeout(() => {
        if (!done) { done = true; proc.kill(); reject(new Error('Python script timed out')) }
      }, timeoutMs)

      proc.on('error', err => {
        if (done) return
        // ENOENT = command not found — silently try next
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          clearTimeout(timer)
          attempt()
        } else {
          done = true
          clearTimeout(timer)
          reject(err)
        }
      })

      proc.on('close', () => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (stderr.trim()) console.error(`[python]`, stderr.trim())
        resolve(stdout)
      })
    }

    attempt()
  })
}
