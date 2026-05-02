import chalk from 'chalk'
import ora from 'ora'
import { execSync } from 'child_process'
import { randomBytes } from 'crypto'
import { chmodSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Write a tmp `.command` script that `open -a Terminal` can launch directly.
 *
 * Why: Terminal.app's `do script` types the cd/run command as keystrokes
 * AFTER sending Cmd+T, which races with interactive shell startup hooks
 * (notably oh-my-zsh's `Would you like to update? [Y/n]` prompt — the
 * first typed character gets consumed as the prompt's answer, leaving the
 * remaining characters as a malformed shell command). Launching a `.command`
 * file via `open` bypasses that model: the script body is the argv passed
 * to the shell, not typed input. We also set `DISABLE_UPDATE_PROMPT` so
 * the omz reminder fires non-interactively in the inner zsh -ic invocation,
 * then drop into a normal interactive shell once the user's command exits.
 */
function writeMacInitScript(absolutePath: string, command?: string): string {
  const scriptPath = join(tmpdir(), `saasfoundry-init-${randomBytes(4).toString('hex')}.command`)
  const cdAndCmd = command ? `cd ${JSON.stringify(absolutePath)} && ${command}` : `cd ${JSON.stringify(absolutePath)}`
  const scriptContent = ['#!/bin/sh', 'rm -f "$0" 2>/dev/null', `DISABLE_UPDATE_PROMPT=true DISABLE_AUTO_UPDATE=true zsh -ic ${JSON.stringify(cdAndCmd)}`, 'exec zsh -i', ''].join('\n')
  writeFileSync(scriptPath, scriptContent)
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

/**
 * Opens a new terminal tab or window with contextual directory and optional command
 * @param directory The directory to open the terminal in
 * @param options Optional command and description
 * @returns Promise<boolean> indicating success or failure
 */
export async function openTerminal(directory: string, options?: { command?: string; description?: string }): Promise<boolean> {
  const { command, description } = options || {}
  const spinnerText = description || (command ? `Running command in terminal...` : `Opening terminal...`)
  const spinner = ora(spinnerText).start()

  try {
    // Get the absolute path
    const absolutePath = `${process.cwd()}/${directory}`
    let success = false

    // Check if we're in WSL
    const isWsl = process.platform === 'linux' && process.env.WSL_DISTRO_NAME
    const platform = isWsl ? 'wsl' : process.platform

    // Detect which terminal emulator the user is currently using
    const currentTerminal = process.env.TERM_PROGRAM
    const isCmux = !!process.env.CMUX_BUNDLE_ID

    // Use different commands based on the operating system
    switch (platform) {
      case 'darwin': {
        // macOS - check for cmux first (terminal multiplexer)
        if (isCmux) {
          try {
            // Create a new terminal surface; cmux replies on stdout with `OK surface:<n> pane:<m> workspace:<k>`
            const cmuxOut = execSync('cmux new-surface --type terminal', { encoding: 'utf8' })
            const surfaceMatch = cmuxOut.match(/\b(surface:\d+)\b/)
            if (!surfaceMatch) throw new Error(`unexpected cmux new-surface output: ${cmuxOut.trim()}`)
            const surfaceRef = surfaceMatch[1]

            // Inject `cd <path> && <command>` then press Enter — cmux waits for shell readiness internally
            const fullCmd = command ? `cd ${absolutePath} && ${command}` : `cd ${absolutePath}`
            execSync(`cmux send --surface ${surfaceRef} ${JSON.stringify(fullCmd)}`, { stdio: 'ignore' })
            execSync(`cmux send-key --surface ${surfaceRef} enter`, { stdio: 'ignore' })
            success = true
          } catch {
            // cmux command failed, fallback to regular terminal
            console.warn(chalk.yellow('Could not create cmux tab, falling back to system terminal'))
          }
        }

        // If not cmux or cmux failed, use the terminal the user is currently in
        if (!success) {
          if (currentTerminal === 'iTerm.app') {
            // User is in iTerm2
            const script = `
          tell application "iTerm"
            tell current window
              create tab with default profile
              tell current session
                write text "cd ${absolutePath}${command ? ` && ${command}` : ''}"
              end tell
            end tell
          end tell
        `
            execSync(`osascript -e '${script}'`)
            success = true
          } else if (currentTerminal === 'Apple_Terminal') {
            // User is in Terminal.app — use a tmp .command file to bypass
            // do-script's keystroke race with shell startup hooks.
            const scriptPath = writeMacInitScript(absolutePath, command)
            execSync(`open -a Terminal ${JSON.stringify(scriptPath)}`)
            success = true
          } else {
            // Unknown terminal or not detected (Warp, Alacritty, etc.)
            // Fallback: try iTerm2 first, then Terminal.app
            try {
              execSync('osascript -e "tell application \\"iTerm\\" to version"', { stdio: 'ignore' })
              const script = `
            tell application "iTerm"
              tell current window
                create tab with default profile
                tell current session
                  write text "cd ${absolutePath}${command ? ` && ${command}` : ''}"
                end tell
              end tell
            end tell
          `
              execSync(`osascript -e '${script}'`)
              success = true
            } catch {
              // iTerm2 not found, fallback to Terminal.app via .command file
              // (same race-avoidance rationale as the Apple_Terminal branch above)
              const scriptPath = writeMacInitScript(absolutePath, command)
              execSync(`open -a Terminal ${JSON.stringify(scriptPath)}`)
              success = true
            }
          }
        }
        break
      }
      case 'win32': {
        // Windows - check for Windows Terminal
        let hasWindowsTerminal = false
        try {
          execSync('where wt.exe', { stdio: 'ignore' })
          hasWindowsTerminal = true
        } catch {
          hasWindowsTerminal = false
        }

        if (hasWindowsTerminal) {
          // Windows Terminal
          if (command) {
            execSync(`wt.exe -w 0 nt -d "${absolutePath}" cmd /k ${command}`)
          } else {
            execSync(`wt.exe -w 0 nt -d "${absolutePath}"`)
          }
          success = true
        } else {
          // Fallback to cmd
          execSync(`start cmd.exe /K "cd ${absolutePath}${command ? ` && ${command}` : ''}"`)
          success = true
        }
        break
      }
      case 'wsl': {
        // WSL - use the default shell
        if (command) execSync(`cd ${absolutePath} && ${command}`)
        else execSync(`cd ${absolutePath}`)
        success = true
        break
      }
      default: {
        // Linux - try to detect current terminal
        const terminals = [
          {
            name: 'gnome-terminal',
            command: (path: string, cmd?: string) =>
              cmd ? `gnome-terminal --tab --working-directory="${path}" -- bash -c "${cmd}; bash"` : `gnome-terminal --tab --working-directory="${path}" -- bash`
          },
          { name: 'konsole', command: (path: string, cmd?: string) => (cmd ? `konsole --new-tab --workdir "${path}" -e bash -c "${cmd}; bash"` : `konsole --new-tab --workdir "${path}"`) },
          { name: 'xterm', command: (path: string, cmd?: string) => (cmd ? `xterm -e "cd ${path} && ${cmd}; bash"` : `xterm -e "cd ${path} && bash"`) }
        ]

        for (const terminal of terminals) {
          try {
            if (command) {
              execSync(terminal.command(absolutePath, command))
            } else {
              execSync(terminal.command(absolutePath))
            }
            success = true
            break
          } catch {
            // Try next terminal
            continue
          }
        }
      }
    }

    if (success) {
      spinner.succeed(chalk.green(command ? `Command started in new terminal tab` : `Terminal opened successfully`))
    } else {
      spinner.fail(chalk.red(`Failed to open terminal`))
    }

    return success
  } catch (error) {
    spinner.fail(chalk.red(`Failed to open terminal`))
    console.error('Failed to open terminal', error)
    return false
  }
}

/**
 * Generates a shell command for initializing Husky and setting up script permissions
 * Uses semicolons instead of && for better AppleScript compatibility
 * @returns A shell command string that handles Husky installation and script permissions
 */
export function getHuskySetupCommand(extraCommand: string = ''): string {
  const huskyCommand = ['npx husky', 'chmod -R +x .husky 2>/dev/null || true', 'chmod -R +x ./scripts/*.sh 2>/dev/null || true']

  if (extraCommand) {
    huskyCommand.push(extraCommand)
  }

  return huskyCommand.join('; ')
}
