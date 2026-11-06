#!/usr/bin/env python3
"""Refresh official evidence, validate it, then build the website's TEC snapshot.
Any source/validation error exits nonzero before the workflow commits changes.
Use --offline to rebuild from preserved source evidence.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    suffix = ['--offline'] if args.offline else []
    for script in ['fetch_energylabel.py', 'fetch_energystar.py']:
        subprocess.run([sys.executable, str(ROOT/'scripts'/script), *suffix], cwd=ROOT, check=True)
    subprocess.run([sys.executable, str(ROOT/'scripts/build_tec_catalog.py')], cwd=ROOT, check=True)
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_catalog.py'], cwd=ROOT, check=True)
    subprocess.run(['node', '--check', 'assets/app.js'], cwd=ROOT, check=True)
    subprocess.run(['node', '--test', 'tests/calculator.test.js'], cwd=ROOT, check=True)
    shutil.copyfile(ROOT/'index.html', ROOT/'mfp-tec-deck.html')
    print('Verified MOEA-first TEC snapshot built successfully.')

if __name__ == '__main__':
    main()
