# Ekka

A free colour-and-number shedding card game for two to eight players, played in the
browser. One person opens a room and shares the four-letter code (or the QR); everyone
else joins from their own phone. Hands stay private on each screen. There is also a
"Play the computer" practice table with bots.

Live at <https://sadapanna.com/app/ekka/>.

## Rules in one paragraph

108 cards: four colours (red, yellow, green, blue; each also has its own shape) of 0–9, Hop (skip), Flip (reverse)
and +2, plus Wild and Wild +4. Match the top card by colour or by number/symbol. If you
can't, draw one; if it fits you may play it. Down to one card you must hit **Ekka!**;
anyone who taps **Catch** first makes you draw two. First empty hand wins the round and
scores the cards everyone else is holding (numbers face value, action cards 20, wilds
50). Optional house rule in the lobby: stacking (+2 on +2, +4 on anything).

## Modes

The host picks one in the lobby (`opts.mode`).

- **Classic** — open ended. Rounds continue for as long as you like; scores accumulate.
- **Timed** — a 5/10/15 minute match. The clock (kept by the host in `room.js`) only runs
  while a round is being played. When it hits zero the engine's `timeUp()` ends the
  round: the lightest hand takes the pot and the highest total wins the match.
- **Ruthless** — draw cards always stack (any draw card answers any other), you draw
  until something fits, the deck gains 4× Wild +6 and 8× Hop all (everyone is skipped,
  you go again), and a hand that reaches 15 cards (`BUST_AT`) is knocked out of the round.

Separately, the host can set a **turn timer** (off / 15 / 30 / 60 s). When it runs out
the host draws for that player (or takes the pending penalty) and moves on.

## Playing

Tap a card to play it, or drag it up onto the table. Sliding a finger along the fan
lifts each card in turn so a crowded hand can be read; that never plays a card. A hand
too wide for the screen splits into two rows. Players pick an emoji avatar and can send
quick emoji reactions, which the host relays to every seat.

## No build step, no backend

Vanilla JS, plain `<script>` tags. The site is static (GitHub Pages), so there is no game
server:

- The **host's browser is the server**. It owns the deck and every hand and sends each
  player only what they are allowed to see.
- Devices connect with WebRTC data channels through PeerJS (`vendor/peerjs.min.js`).
  The public PeerJS broker is used only to introduce devices by room code
  (`sadapanna-ekka-<CODE>`); game messages travel device to device. On one wifi that is
  a direct local connection. Across different networks it usually works too, but there
  is no TURN relay, so strict NATs / some mobile carriers can fail to connect.
- If the host closes the tab the room ends. A host *refresh* reopens the same room from
  a `sessionStorage` snapshot, and guests reconnect on their own.

| File | Responsibility |
| --- | --- |
| `js/engine.js` | Pure rules: deck, legal moves, effects, scoring, per-player views, bot. Runs in Node too. |
| `js/net.js` | Transport. PeerJS, or BroadcastChannel when the URL has `?local=1` (tabs of one browser, for testing). |
| `js/room.js` | `HostRoom` (roster, rounds, bot timers, reconnects, snapshot) and `GuestClient`. |
| `js/ui.js` | Screens, table rendering, card-flight animations, input. |
| `js/sfx.js` | Synthesised sound effects (WebAudio, no audio files). |

## Testing locally

Serve the **site root** (fonts are root-absolute) and open
`/app/ekka/?local=1` in several tabs of the same browser: rooms then work without
any network. Add `&fast=1` to make the computer players, the turn timer and the match
clock run about eight times faster. `window.__ekka` exposes the current view for scripts.

The rules engine has no DOM dependencies: `require('./js/engine.js')` in Node and play
bots against each other to check a rule change.
