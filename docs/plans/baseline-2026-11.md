# Faza 0: Baseline (4 noiembrie 2026)

Măsurat pe Mac-ul tău, cu aplicația semnată `Mysthi.app`. Codul de pornire este `0c80c0d` plus corecturile din această fază. Toate cifrele de mai jos sunt măsurate aici, nu preluate din alte surse.

## Sistem și model

| Ce | Valoare |
|---|---|
| Mac | M5 Pro, 24 GB RAM, macOS 26.6.2 |
| Ollama | 0.40.11 |
| Modele pe disc | doar `qwen3-vl:8b-instruct` (6,2 GB, Q4_K_M, renderer `qwen3-vl-instruct`, fără gândire) |
| Model încărcat | 5,3 GB, integral pe GPU |
| Procese Ollama + Mysthi | 6,1 GB RSS |
| Memorie liberă în sistem | 24% (învățare oprită), 27% (învățare pornită) |
| Teste | 201 / 201 trec (`npm test`, ~2 s) |

## Chat: timp de răspuns

Trei întrebări (RO și EN), trimise prin serviciul real de chat, cu un istoric de unică folosință.

| Situație | Primul cuvânt | Răspuns complet |
|---|---|---|
| Model rece (se încarcă), învățare oprită | 5,8 s | 7,6 s |
| Model rece, învățare pornită | 3,3 s | 4,7 s |
| Model deja încărcat (ambele cazuri) | 0,1 s | 0,7–1,6 s |
| O cerere de notițe e deja în lucru | observat ~20 s; poate ajunge la ~2 min | (fereastra afișează „her model is busy…”) |

## Verificări

- **Obsidian Sync:** pluginul de bază e pornit, dar **nu ești conectat la un cont Obsidian**, deci nu se sincronizează nimic. Vault-ul (inclusiv `mysthi/`) e strict local. Dacă te conectezi vreodată, oprește pluginul Sync sau exclude `mysthi/`.
- **Fereastra pisicii** afișează doar variante de „Miaw!” și emoji, prin `textContent`. Ignoră orice text primit și nu poate arăta text din notițe.
- **`claude.js`** nu mai există. **`@anthropic-ai/sdk`** e încă în `package.json`, nefolosit (se scoate în faza 6).
- **Modele vechi șterse:** `qwen3-vl:8b` (ediția thinking), `qwen2.5vl:7b`, `llama3.1:8b`, `llama3.2:3b`, `llama3.2:1b` (~20 GB eliberați).

## Probleme găsite și rezolvate în faza 0

1. **Învățarea s-a oprit singură azi la 15:50** și n-a mai înregistrat nimic până când ai repornit-o. Cauza exactă nu se mai poate afla: aplicația nu păstra motivul. Nu există rapoarte de crash, deci helper-ul nu a dat crash.
   - **Corectură:** un jurnal de evenimente, `learning/events.log`. Notează când se pornește sau se oprește învățarea și de ce: de tine, helper ieșit cu codul X, pornire eșuată cu eroarea Y. Conține doar ore și motive, maxim ~64 KB.
   - Data viitoare, motivul va fi acolo.
2. **Chatul pretindea că învață când învățarea era oprită** („Miaw, yes — I'm still learning…”).
   - **Corectură:** la fiecare mesaj, chatul primește starea reală a învățării și regula să nu pretindă că învață sau că reține din chat.

## Gata pentru faza 1

Da. Un singur model, rapid odată încărcat. Vault strict local. Învățarea pornește din nou și lasă urme dacă se oprește.
