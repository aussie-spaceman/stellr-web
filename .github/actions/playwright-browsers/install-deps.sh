#!/usr/bin/env bash
# Installs the system libraries Playwright's browsers need, for action.yml.
#
# Env:
#   BROWSERS        space-separated browsers, as for `playwright install-deps`
#   ARCHIVES        the apt archive directory the cache restores (debs + lists/)
#   RESTORED        exact | earlier | none: what the cache restore found
#   APT_TRY_SECONDS limit on each bounded online try (default 180)
#
# Writes source=offline|online to $GITHUB_OUTPUT, so the action saves the cache
# only after an online install.
#
# Order:
#   exact    offline; then online, three tries
#   earlier  online once (the weekly refresh); then offline; then two more
#   none     online, three tries
#
# On 11 Nov 2026 runners could not resolve the Ubuntu mirrors for hours. Every
# browser job failed although the debs were cached, because `install-deps`
# always runs `apt-get update` first. The offline install below needs no network:
# it installs the cached debs against package lists saved with them, after
# checking those lists against Ubuntu's signing key, as `apt-get update` would.
set -uo pipefail

archives=${ARCHIVES:?}
saved_lists="$archives/lists"
apt_lists=/var/lib/apt/lists
try_seconds=${APT_TRY_SECONDS:-180}
max_age_days=14
read -r -a browsers <<< "${BROWSERS:?}"

# The image's own Ubuntu sources name the key that signs the archive.
keyring=$(sed -n 's/^Signed-By: *//p' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null | head -n 1)
keyring=${keyring:-/usr/share/keyrings/ubuntu-archive-keyring.gpg}

# --- Stopping a try -----------------------------------------------------------
# `timeout` signals its own process group, but sudo runs the command in a session
# of its own, so a stopped try left apt-get running. It kept the lists lock, and
# on 11 Nov the next two tries failed at once with "Could not get lock
# /var/lib/apt/lists/lock. It is held by process N (apt-get)". So stop apt-get by
# name. dpkg is left to finish rather than killed mid-unpack; then
# `dpkg --configure -a` completes anything it left half-configured.
stop_apt() {
  if pgrep -x apt-get > /dev/null; then
    echo "Stopping the apt-get that try left running: $(pgrep -d ' ' -x apt-get)"
    sudo pkill -TERM -x apt-get || true
    for _ in $(seq 15); do pgrep -x apt-get > /dev/null || break; sleep 1; done
    sudo pkill -KILL -x apt-get || true
    for _ in $(seq 5); do pgrep -x apt-get > /dev/null || break; sleep 1; done
  fi
  for _ in $(seq 120); do pgrep -x dpkg > /dev/null || break; sleep 1; done
  sudo dpkg --configure -a || true
}

# --- Online -------------------------------------------------------------------
# A package a security update has replaced is still downloaded, so the mirror
# can stall this. A stalled try is stopped and retried: apt keeps what it has
# fetched, and a fresh connection often lands somewhere faster. A limit of 0
# means none but the job's timeout.
try_online() {
  local limit=$1
  if [ "$limit" = 0 ]; then
    npx playwright install-deps "${browsers[@]}" && return 0
  else
    timeout -k 10 "$limit" npx playwright install-deps "${browsers[@]}" && return 0
  fi
  echo "::warning::Installing browser libraries from the Ubuntu mirror failed or took over ${limit}s. Retrying."
  stop_apt
  return 1
}

# Keeps the lists the online install used, beside the debs it fetched, so a later
# run can install offline against exactly these. Ubuntu sources only matter, but
# which those are is decided when loading, by the signature.
save_lists() {
  sudo rm -rf "$saved_lists"
  sudo mkdir -p "$saved_lists"
  local release prefix
  for release in "$apt_lists"/*_InRelease; do
    [ -e "$release" ] || continue
    prefix=${release##*/}
    prefix=${prefix%InRelease}
    sudo cp "$release" "$saved_lists/"
    sudo find "$apt_lists" -maxdepth 1 -type f -name "${prefix}*_Packages" -exec cp -t "$saved_lists/" {} +
  done
  echo "Saved $(find "$saved_lists" -type f | wc -l) package list files with the cache."
}

# --- Offline ------------------------------------------------------------------
# A cache is written by this repo's own workflow runs, but treat what it restores
# as untrusted: each InRelease must carry a good signature from the Ubuntu archive
# key, and each Packages file must match the size and SHA256 that signed text
# gives it. That is what `apt-get update` checks. A list past its Valid-Until or
# over two weeks old is refused too (the cache key turns over weekly), which apt
# would not refuse, so a stale cache cannot hold packages back. apt then checks every cached deb against the hashes in these
# lists before installing it, as it does for a download.
load_saved_lists() {
  if [ ! -d "$saved_lists" ]; then
    echo "The restored cache has no saved package lists, so it cannot install offline."
    return 1
  fi
  if ! command -v gpgv > /dev/null || [ ! -r "$keyring" ]; then
    echo "No gpgv or no Ubuntu archive keyring ($keyring), so the saved lists cannot be checked."
    return 1
  fi

  local work staged=0 release name prefix signed date until list path sum size packages
  work=$(mktemp -d)
  mkdir -p "$work/ok"
  for release in "$saved_lists"/*_InRelease; do
    [ -e "$release" ] || continue
    name=${release##*/}
    prefix=${name%InRelease}
    signed="$work/$name.txt"
    # --output writes only the signed text, so nothing outside the signature is read.
    if ! gpgv --quiet --keyring "$keyring" --output "$signed" "$release" 2> /dev/null; then
      echo "Skipping $name: not signed by the Ubuntu archive key."  # another repo's, or altered
      continue
    fi
    date=$(date -u -d "$(sed -n 's/^Date: //p' "$signed" | head -n 1)" +%s 2> /dev/null) || continue
    if [ "$date" -lt "$(($(date -u +%s) - max_age_days * 86400))" ]; then
      echo "Saved $name is over $max_age_days days old; not using it."
      continue
    fi
    until=$(sed -n 's/^Valid-Until: //p' "$signed" | head -n 1)
    if [ -n "$until" ] && [ "$(date -u -d "$until" +%s 2> /dev/null || echo 0)" -lt "$(date -u +%s)" ]; then
      echo "Saved $name expired ($until); not using it."
      continue
    fi

    packages=0
    for list in "$saved_lists/$prefix"*_Packages; do
      [ -e "$list" ] || continue
      path=${list##*/}
      path=${path#"$prefix"}
      path=${path//_//}
      sum=$(sha256sum "$list" | cut -d ' ' -f 1)
      size=$(stat -c %s "$list")
      if awk -v s="$sum" -v z="$size" -v p="$path" '
          /^SHA256:/ { f = 1; next }
          /^[^ ]/ { f = 0 }
          f && $1 == s && $2 == z && $3 == p { ok = 1 }
          END { exit !ok }' "$signed"; then
        cp "$list" "$work/ok/"
        packages=$((packages + 1))
      else
        echo "::warning::Saved $path for $name does not match its signed index; not using it."
      fi
    done
    if [ "$packages" -gt 0 ]; then
      cp "$release" "$work/ok/"
      staged=$((staged + 1))
    fi
  done

  if [ "$staged" = 0 ]; then
    echo "None of the saved package lists passed the signature check."
    rm -rf "$work"
    return 1
  fi
  sudo cp "$work/ok/"* "$apt_lists/"
  echo "Loaded $(find "$work/ok" -type f | wc -l) checked package list files from $staged signed indexes."
  rm -rf "$work"
}

# Playwright's own dry run asks apt which packages are missing (`apt-get install
# -s`), so this installs exactly what `install-deps` would, dependencies included.
needed_packages() {
  local out
  out=$(npx playwright install-deps --dry-run "${browsers[@]}" 2>&1)
  if grep -q '^All system dependencies are installed' <<< "$out"; then
    return 0
  fi
  if ! grep -q '^Missing system dependencies' <<< "$out"; then
    echo "$out" >&2
    echo "Could not work out the packages from Playwright's dry run." >&2
    return 1
  fi
  awk '/^Missing system dependencies/ { f = 1; next } f && /^  [^ ]/ { print $1 }' <<< "$out"
}

try_offline() {
  echo "Installing browser libraries from the restored cache, without the network."
  load_saved_lists || return 1
  local packages
  packages=$(needed_packages) || return 1
  if [ -z "$packages" ]; then
    echo "All system dependencies are already installed."
    return 0
  fi
  echo "Installing $(wc -w <<< "$packages") packages from the cache."
  # shellcheck disable=SC2086 # one package per word
  if sudo apt-get install -y --no-install-recommends --no-download $packages; then
    return 0
  fi
  echo "::warning::The cache lacks some of the packages needed; installing from the mirror instead."
  return 1
}

# --- Main ---------------------------------------------------------------------
finish() {
  echo "source=$1" >> "${GITHUB_OUTPUT:-/dev/null}"
  if [ "$1" = online ]; then
    # Drop superseded versions, so the cache does not grow.
    sudo apt-get autoclean -qq || true
    save_lists
  fi
  echo "Browser libraries installed ($1)."
  exit 0
}

case ${RESTORED:-none} in exact | earlier | none) ;; *)
  echo "::error::RESTORED must be exact, earlier or none, not '${RESTORED}'."
  exit 2
  ;;
esac

if [ "$RESTORED" = exact ] && try_offline; then finish offline; fi
for attempt in 1 2 3; do
  limit=$try_seconds
  [ "$attempt" = 3 ] && limit=0
  if try_online "$limit"; then finish online; fi
  if [ "$attempt" = 1 ] && [ "$RESTORED" = earlier ] && try_offline; then finish offline; fi
done
echo "::error::Could not install the browser libraries."
exit 1
