#!/usr/bin/env bash
# OpenOS — yerel statik sunucu (ES modülleri file:// üzerinden çalışmaz)
#   /      tanıtım sitesi
#   /os/   işletim sisteminin kendisi
cd "$(dirname "$0")"
exec python3 serve.py "${1:-8080}"
