#!/usr/bin/env python3
import sys
from run_import_reconciliation import main

if __name__ == "__main__":
    sys.argv[1:1] = ["--module", "fif_reimbursements"]
    raise SystemExit(main())
