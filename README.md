# DOMINO SKY

DOMINO SKY is a deterministic airline disruption simulator using the supplied 16-airport, 70-flight sample network.

## Run

Backend:

```powershell
cd domino-sky/backend
python -m uvicorn app.main:app --reload
```

Frontend:

```powershell
cd domino-sky/frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Test

```powershell
cd domino-sky/backend
python -m pytest
```
