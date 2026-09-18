"""Executa as regressões que substituíram as reproduções dos bugs da revisão."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tests'))
from test_regressoes_review import main

if __name__ == '__main__':
    main()
