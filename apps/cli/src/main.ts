import { readFile } from 'node:fs/promises'
import { text } from 'node:stream/consumers'
import { run } from './cli'
import { credentialsPath } from './credentials'
import { openInBrowser } from './login'

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  readFile: (path) => readFile(path, 'utf8'),
  readStdin: () => text(process.stdin),
  credentialsPath: credentialsPath(process.env),
  openUrl: openInBrowser,
  fetch,
})
