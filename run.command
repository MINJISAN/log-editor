#!/bin/bash
cd "$(dirname "$0")"
npm run dev &
sleep 2
open http://localhost:5173
