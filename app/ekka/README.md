# Ekka

A free colour-and-number shedding card game for two to eight players, played in the
browser. One person opens a room and shares the four-letter code (or the QR); everyone
else joins from their own phone. Hands stay private on each screen. There is also a
"Play the computer" mode with three bots.

Live at <https://sadapanna.com/app/ekka/>.

## Rules in one paragraph

108 cards: four colours (coral, mango, teal, violet) of 0–9, Hop (skip), Flip (reverse)
and +2, plus Wild and Wild +4. Match the top card by colour or by number/symbol. If you
can't, draw one; if it fits you may play it. Down to one card you must hit **Ekka!**;
anyone who taps **Catch** first makes you draw two. First empty hand wins the round and
scores the cards everyone else is holding. Optional house rule in the lobby: stacking
(+2 on +2, +4 on anything).

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
any network. Add `&fast=1` to make the computer players move quickly.
