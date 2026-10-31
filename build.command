#!/bin/bash
# ორჯერ დააწკაპუნეთ: issues/ საქაღალდიდან საიტის data/ საქაღალდე თავიდან აეწყობა.
cd "$(dirname "$0")" || exit 1
python3 build.py
echo
read -n 1 -s -r -p "დააჭირეთ ნებისმიერ ღილაკს დასახურად..."
