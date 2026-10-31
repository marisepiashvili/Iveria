@echo off
rem ორჯერ დააწკაპუნეთ: issues\ საქაღალდიდან საიტის data\ საქაღალდე თავიდან აეწყობა.
chcp 65001 >nul
cd /d "%~dp0"
python build.py
pause
