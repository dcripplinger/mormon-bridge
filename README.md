## Mormon Bridge - Game Design Overview

This document outlines the gameplay rules and project scope for the Mormon Bridge card game built in Godot 4.4.1. It's a high-level reference for future planning and implementation.

### Platforms and Tech
- Target platforms: Android (phone + tablet) and Web (itch.io)
- Engine: Godot 4.4.1, 2D
- Repo layout: the Godot project is in `godot/`. Non-runtime assets/docs can live at repo root.

### Gameplay summary

Mormon Bridge is a rummy game (despite its name) where each player is trying to minimize their score by getting rid of their cards in the form of groups and runs. Each turn, a player must draw a card, may play cards if possible, and then must discard a card. To play cards, they must first "go down" by simultaneously playing the required sets of groups and runs for the round. Afterwards, they may play any number of cards on any already played sets on the table.

A distinguishing feature of Mormon Bridge is buying. Non-active players may call out "Buy it!" when they see a discard they want. If they're fast enough and the active player doesn't claim the discard, the buyer gets the discard along with an additional penalty card. This is often a crucial strategy to get the cards needed to complete the sets and go down.

### Deck
- Uses the equivalent of 3 combined Rook decks. A Mormon Bridge deck therefore has:
  - 3x numbers 1-14 per color, with colors:
	- Red
	- Yellow
	- Green
	- Black
  - 3x wild (Rook)
- Total deck = 3 x (4 x 14 + 1) = 171 cards

### Players & Setup
- 3 to 5 players
- Each round: deal 11 cards to each player
- First player rotates each round
- When players are ready, start the round by flipping the top card into the discard pile (this is available for buying)

### Round Requirements (in order)

Each round, a player must "go down" before playing individual cards on already played sets. Going down means to simultaneously play the required sets for the round. There are 7 rounds in the game, with the following sets:
1) 2 groups
2) 1 group and 1 run
3) 2 runs
4) 3 groups
5) 2 groups and 1 run
6) 1 group and 2 runs
7) 3 runs

Definitions:
- Group: 3+ cards of the same number; at most 1 wild may substitute
- Run: 4+ cards of the same color in consecutive order; at most 1 wild may substitute

Wilds:
- The wild can substitute for any single card
- Limit: at most 1 wild per group or run

### Turn Sequence
Each turn proceeds in this order:
1) Buy window (before draw): Other players may call "Buy it!" to request the top discard
   - The current player may either:
     - Allow the first buyer to buy the top discard, or
     - Claim the top discard as their own draw instead
   - If a buy is allowed:
     - Buyer immediately takes the top discard into hand
     - Buyer must also draw the top card from the deck as a penalty
     - Then the current player draws from the deck to start their turn
2) Draw: If no buy occurs, the current player chooses to draw from deck or take the top discard
3) Play (optional):
   - If the player has not gone down this round: they may go down by placing that round's required sets (see Going Down)
   - If the player has already gone down: they may extend any sets on the table (their own or others')
4) Discard: End the turn by discarding one card to the discard pile
5) If a player empties their hand after playing/discarding, the round ends immediately

### Going Down
- A player "goes down" by placing exactly the required sets for the round (per Round Requirements)
- After going down, the player can no longer create brand-new sets; they may only extend existing sets already on the table (their own or other players')

### Extending Sets
- On turns after going down, a player may add appropriate cards (respecting the 1-wild limit per set) to any existing group or run on the table

### Scoring
- At round end, each player scores penalty points for cards left in hand:
  - 1-8: 5 points each
  - 9-14: 10 points each
  - Wild: 20 points each
- Points are bad; lowest total after 7 rounds wins

### End of Round and Game
- Round ends when any player has no cards in hand after playing/discarding
- Tally points from cards in hand and add to cumulative totals
- After 7 rounds, the player with the lowest total score wins

### Multiplayer
- Goal: Online multiplayer with private rooms (room passwords)
- Simple UX: create/join room, room code/password, ready-up
- Networking: Godot Multiplayer (WebSocket); host- or server-authoritative turn sync

### AI (initial behavior)
- Extremely simple AI for early development:
  - Always allows buys by others
  - Always draws from the deck
  - Discards the same card it drew (no strategy)
- Future: Add basic heuristics (avoid breaking potential sets, defend against buys, prefer discard pickup when useful)

### UI/UX Notes
- Consistent 2D card visuals and sizing (no stretch)
- Clear turn/phase indicator
- Buy window is time-limited and clearly indicated; buying is a single-tap action
- Hand supports selection/multi-selection for going down and extending

