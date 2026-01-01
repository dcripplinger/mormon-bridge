extends Node

const MIN_PLAYERS := 3
const MAX_PLAYERS := 5

enum TurnPhase {AWAIT_BUY, DRAW, PLAY_OR_DISCARD, ROUND_END}

@onready var deck: Deck = Deck.new()
@onready var rules: GameRules = GameRules.new()

var players: Array[Player] = []
var current_player_index: int = 0
var round_index: int = 0
var turn_phase: TurnPhase = TurnPhase.DRAW
var has_drawn_this_turn: bool = false

var scores: Dictionary = {}
var table_melds: Array = [] # Array of {owner:int, type:"group"|"run", cards:Array[Card]}

signal state_changed()
signal buy_window_opened()
signal buy_window_closed()

func _ready() -> void:
	add_child(deck)
	add_child(rules)

func new_local_game(num_humans: int, num_ai: int) -> void:
	players.clear()
	scores.clear()
	for i in range(num_humans + num_ai):
		var p := Player.new()
		p.player_id = i
		p.is_ai = i >= num_humans
		if p.is_ai:
			p.display_name = "AI %d" % (i - num_humans + 1)
		else:
			p.display_name = "You" if i == 0 else "P%d" % (i + 1)
		players.append(p)
		scores[p.player_id] = 0
	start_round(0)

func start_round(index: int) -> void:
	round_index = index
	deck.build_three_rook_decks()
	deck.shuffle()
	var hands: Array = deck.deal_hands(players.size())
	for i in range(players.size()):
		var p: Player = players[i]
		var hand_i: Array[Card] = hands[i]
		p.hand = hand_i
		p.has_gone_down = false
		p.sort_hand()
	table_melds.clear()
	# Flip one card to discard to start
	var first_discard := deck.draw()
	if first_discard:
		deck.discard(first_discard)
	current_player_index = 0
	has_drawn_this_turn = false
	turn_phase = TurnPhase.AWAIT_BUY
	emit_signal("state_changed")
	emit_signal("buy_window_opened")

func next_turn() -> void:
	current_player_index = (current_player_index + 1) % players.size()
	has_drawn_this_turn = false
	turn_phase = TurnPhase.AWAIT_BUY
	emit_signal("state_changed")
	emit_signal("buy_window_opened")

func current_player() -> Player:
	return players[current_player_index]

func allow_buy_from_non_current_player(buyer_index: int) -> bool:
	if turn_phase != TurnPhase.AWAIT_BUY:
		return false
	if buyer_index == current_player_index:
		return false
	var top := deck.take_top_discard()
	if top == null:
		return false
	players[buyer_index].hand.append(top)
	players[buyer_index].hand.append(deck.draw())
	players[buyer_index].sort_hand()
	# Current player must draw from deck now
	has_drawn_this_turn = true
	var drawn := deck.draw()
	if drawn:
		current_player().hand.append(drawn)
		current_player().sort_hand()
	turn_phase = TurnPhase.PLAY_OR_DISCARD
	emit_signal("buy_window_closed")
	emit_signal("state_changed")
	# If current player is AI, immediately discard the drawn card
	if current_player().is_ai and drawn:
		discard_from_current(drawn)
	return true

func claim_discard_as_draw_for_current() -> bool:
	if turn_phase != TurnPhase.AWAIT_BUY:
		return false
	var top := deck.take_top_discard()
	if top == null:
		return false
	current_player().hand.append(top)
	current_player().sort_hand()
	has_drawn_this_turn = true
	turn_phase = TurnPhase.PLAY_OR_DISCARD
	emit_signal("buy_window_closed")
	emit_signal("state_changed")
	return true

func draw_from_deck_for_current() -> bool:
	if turn_phase == TurnPhase.AWAIT_BUY or turn_phase == TurnPhase.DRAW:
		var card := deck.draw()
		if card == null:
			return false
		current_player().hand.append(card)
		current_player().sort_hand()
		has_drawn_this_turn = true
		turn_phase = TurnPhase.PLAY_OR_DISCARD
		emit_signal("buy_window_closed")
		emit_signal("state_changed")
		# If current player is AI, immediately discard the drawn card
		if current_player().is_ai:
			discard_from_current(card)
		return true
	return false

func discard_from_current(card: Card) -> bool:
	if turn_phase != TurnPhase.PLAY_OR_DISCARD:
		return false
	if not has_drawn_this_turn:
		return false
	var idx := current_player().hand.find(card)
	if idx == -1:
		return false
	current_player().hand.remove_at(idx)
	deck.discard(card)
	if current_player().hand.is_empty():
		finish_round()
	else:
		next_turn()
	return true

func finish_round() -> void:
	turn_phase = TurnPhase.ROUND_END
	# Tally scores
	for p in players:
		scores[p.player_id] += GameRules.score_hand(p.hand)
	emit_signal("state_changed")

func get_round_requirement_text() -> String:
	var req: Dictionary = GameRules.ROUNDS[round_index]
	return "%dg %dr" % [int(req["groups"]), int(req["runs"])]

func try_make_group_from_current(selected: Array[Card]) -> bool:
	if selected.size() < 3:
		return false
	if not GameRules.is_valid_group(selected):
		return false
	# Remove from hand
	for c in selected:
		var idx := current_player().hand.find(c)
		if idx != -1:
			current_player().hand.remove_at(idx)
	# Add to table
	table_melds.append({"owner": current_player().player_id, "type": "group", "cards": selected.duplicate()})
	current_player().has_gone_down = true
	current_player().sort_hand()
	emit_signal("state_changed")
	return true

func try_make_run_from_current(selected: Array[Card]) -> bool:
	if selected.size() < 4:
		return false
	if not GameRules.is_valid_run(selected):
		return false
	for c in selected:
		var idx := current_player().hand.find(c)
		if idx != -1:
			current_player().hand.remove_at(idx)
	table_melds.append({"owner": current_player().player_id, "type": "run", "cards": selected.duplicate()})
	current_player().has_gone_down = true
	current_player().sort_hand()
	emit_signal("state_changed")
	return true

func perform_ai_turn_if_needed() -> void:
	var p := current_player()
	if not p.is_ai:
		return
	# Simple AI: always allow buyers, always draw from deck, discard the same card drawn
	# Allow a small delay for UX controlled by caller/UI
	if turn_phase == TurnPhase.AWAIT_BUY:
		# In this MVP, human can buy during AI turn via UI button; we just proceed to draw after a short window externally.
		pass
	elif turn_phase == TurnPhase.DRAW:
		draw_from_deck_for_current()
	elif turn_phase == TurnPhase.PLAY_OR_DISCARD and has_drawn_this_turn:
		var last_card: Card = p.hand[p.hand.size() - 1]
		discard_from_current(last_card)
