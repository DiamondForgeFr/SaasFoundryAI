# Sourced by the hooks before they call node, npm or npx (#1317). Not a hook itself.
#
# Git runs a hook with the PATH of the process that commits. A GUI client, or a coding agent's
# non-login shell, often has the machine's default Node first on that PATH, not the one .nvmrc
# names, and npm then refuses the project's devEngines (EBADDEVENGINES) without saying why.
# When the Node on PATH is older than the major version .nvmrc names, the hook puts the version
# nvm has installed for it first on PATH. When nvm has none, it says which Node it runs under and
# what to do, and stops the hook: nothing continues under a Node older than the project's.
# POSIX sh only, safe under `sh -e`: husky 9 runs hooks with sh, which is dash on most Linux hosts.

# Git runs hooks from the top of the working tree, where .nvmrc lives.
sf_nvmrc="$PWD/.nvmrc"
if [ -f "$sf_nvmrc" ]; then
  sf_node_want=$(tr -d ' \t\r\n' <"$sf_nvmrc")
  sf_node_want=${sf_node_want#v}
  case "$sf_node_want" in
    # An alias (lts/*, node) or an empty file: only nvm resolves it, so the PATH is kept.
    '' | .* | *[!0-9.]*) ;;
    *)
      sf_node_want_major=${sf_node_want%%.*}
      sf_node_have=$(node -v 2>/dev/null || true)
      sf_node_have=${sf_node_have#v}
      sf_node_have_major=${sf_node_have%%.*}
      case "$sf_node_have_major" in
        '' | *[!0-9]*) sf_node_have_major=0 ;;
      esac
      if [ "$sf_node_have_major" -lt "$sf_node_want_major" ]; then
        sf_nvm_versions="${NVM_DIR:-$HOME/.nvm}/versions/node"
        sf_node_bin=''
        if [ -x "$sf_nvm_versions/v$sf_node_want/bin/node" ]; then
          sf_node_bin="$sf_nvm_versions/v$sf_node_want/bin"
        else
          # The exact version is not installed: the most recent one of the same major will do.
          sf_node_found=$(ls "$sf_nvm_versions" 2>/dev/null | sed -n "s/^v\($sf_node_want_major\.[0-9][0-9.]*\)\$/\1/p" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
          if [ -n "$sf_node_found" ] && [ -x "$sf_nvm_versions/v$sf_node_found/bin/node" ]; then
            sf_node_bin="$sf_nvm_versions/v$sf_node_found/bin"
          fi
        fi
        if [ -n "$sf_node_bin" ]; then
          PATH="$sf_node_bin:$PATH"
          export PATH
        else
          sf_node_path=$(command -v node 2>/dev/null || echo 'no node on PATH')
          echo "husky - this hook runs under Node ${sf_node_have:-none} ($sf_node_path) but .nvmrc asks for $sf_node_want, and nvm has no Node $sf_node_want_major installed: run \`nvm install\` in $PWD, or put Node $sf_node_want first on PATH, then retry." >&2
          exit 1
        fi
      fi
      ;;
  esac
fi
