#!/usr/bin/env bash
# Derives the game's Earth textures from the Solar System Scope texture library
# (https://www.solarsystemscope.com/textures/, CC BY 4.0, based on NASA imagery).
#
#   scripts/process-textures.sh <src-dir> [<8k-dir>]
#
# <src-dir> must contain the 4K set as redistributed with three.js
# (examples/textures/planets): earth_day_4096.jpg, earth_night_4096.jpg,
# earth_bump_roughness_clouds_4096.jpg, plus stars8k.jpg
# (Solarsystemscope_texture_8k_stars_milky_way.jpg from Wikimedia Commons).
# <8k-dir> is optional and may contain day8k.jpg / night8k.jpg / clouds8k.jpg
# (the 8K originals from Wikimedia Commons) for the "ultra" quality tier.
#
# Requires ImageMagick.
set -euo pipefail
SRC="$1"; HI="${2:-}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/textures"
mkdir -p "$OUT"

# 4K tier — already well compressed, keep the bytes untouched.
cp "$SRC/earth_day_4096.jpg"   "$OUT/earth_day_4k.jpg"
cp "$SRC/earth_night_4096.jpg" "$OUT/earth_night_4k.jpg"
# Packed auxiliary map: R = elevation (bump), G = land mask / roughness, B = clouds.
cp "$SRC/earth_bump_roughness_clouds_4096.jpg" "$OUT/earth_aux_4k.jpg"

# 2K tier for low-end GPUs and phones.
for n in day night aux; do
  convert "$OUT/earth_${n}_4k.jpg" -filter Lanczos -resize 2048x1024 -quality 86 "$OUT/earth_${n}_2k.jpg"
done

# Milky Way backdrop (galactic coordinates).
convert "$SRC/stars8k.jpg" -filter Lanczos -resize 4096x2048 -quality 88 "$OUT/stars_4k.jpg"
convert "$SRC/stars8k.jpg" -filter Lanczos -resize 2048x1024 -quality 86 "$OUT/stars_2k.jpg"

# Optional 8K tier.
if [ -n "$HI" ]; then
  [ -f "$HI/day8k.jpg" ]    && convert "$HI/day8k.jpg"    -quality 88 "$OUT/earth_day_8k.jpg"
  [ -f "$HI/night8k.jpg" ]  && convert "$HI/night8k.jpg"  -quality 86 "$OUT/earth_night_8k.jpg"
  [ -f "$HI/clouds8k.jpg" ] && convert "$HI/clouds8k.jpg" -colorspace Gray -quality 84 "$OUT/earth_clouds_8k.jpg"
fi
ls -la "$OUT"
