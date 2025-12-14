#!/usr/bin/env bash

# save_folders_csv.sh
# Usage: save_folders_csv.sh [directory] [output.csv]
# Defaults: directory='.' output='folders_DD-MM-YYYY.csv'

set -euo pipefail

dir="${1:-.}"
out="${2:-}"

date_str=$(date +%d-%m-%Y)
if [[ -z "$out" ]]; then
  out="folders_${date_str}.csv"
fi

if [[ ! -d "$dir" ]]; then
  echo "Error: directory '$dir' not found" >&2
  exit 1
fi

# Write header (add size_bytes)
printf 'foldername,date,size_bytes\n' > "$out"

# Ensure globbing includes hidden directories; nullglob removes literal patterns when empty
shopt -s nullglob dotglob 2>/dev/null || true

# Function to compute size in bytes. Tries GNU `du -sb`, then `du -sk` (convert to bytes),
# then falls back to Python summing file sizes.
get_size_bytes() {
  local path="$1"
  local size

  if command -v du >/dev/null 2>&1; then
    if size=$(du -sb "$path" 2>/dev/null | awk '{print $1}'); then
      if [[ -n "$size" ]]; then
        printf '%s' "$size"
        return
      fi
    fi

    if size=$(du -sk "$path" 2>/dev/null | awk '{print $1}'); then
      if [[ -n "$size" ]]; then
        printf '%s' "$((size * 1024))"
        return
      fi
    fi
  fi

  for py in python3 python; do
    if command -v "$py" >/dev/null 2>&1; then
      "$py" - <<PY "$path"
import os,sys
p=sys.argv[1]
total=0
for root,dirs,files in os.walk(p):
    for f in files:
        try:
            total += os.path.getsize(os.path.join(root,f))
        except Exception:
            pass
print(total)
PY
      return
    fi
  done

  printf '0'
}

# Iterate immediate subdirectories
for path in "$dir"/*/; do
  [ -d "$path" ] || continue
  name="$(basename "$path")"
  size_bytes=$(get_size_bytes "$path")

  # Escape any double quotes in the folder name and wrap it in quotes for CSV safety
  esc_name="${name//\"/\"\"}"
  printf '"%s","%s",%s\n' "$esc_name" "$date_str" "$size_bytes" >> "$out"
done

printf "Wrote %s\n" "$out"
