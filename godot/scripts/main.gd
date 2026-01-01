extends Node2D

# References to scene nodes
@onready var camera: CameraController = $Camera
@onready var table_content: Node2D = $TableContent
@onready var deck_node: Node2D = $TableContent/Deck
@onready var discard_node: Node2D = $TableContent/DiscardPile
@onready var player_hand_container: Control = $HandLayer/PlayerHand

var selected_card: Card = null
var multi_selected: Array[Card] = []

var buy_window_timer: Timer

func _ready() -> void:
	# Camera is already enabled and positioned in the scene
	
	# Connect to game state changes
	GameManager.state_changed.connect(_refresh_ui)
	GameManager.buy_window_opened.connect(_on_buy_window_opened)
	GameManager.buy_window_closed.connect(_on_buy_window_closed)
	
	# Setup buy window timer
	buy_window_timer = Timer.new()
	buy_window_timer.one_shot = true
	add_child(buy_window_timer)
	buy_window_timer.timeout.connect(_on_buy_window_timeout)
	
	# Start the game
	GameManager.new_local_game(1, 2)
	_refresh_ui()

func _on_buy_window_opened() -> void:
	var is_ai_turn := GameManager.current_player().is_ai
	# TODO: Add buy button to hand layer when we implement UI
	if is_ai_turn:
		buy_window_timer.start(2.0)

func _on_buy_window_closed() -> void:
	if buy_window_timer.time_left > 0:
		buy_window_timer.stop()

func _on_buy_window_timeout() -> void:
	# Proceed with AI turn
	GameManager.draw_from_deck_for_current()
	await get_tree().process_frame
	GameManager.perform_ai_turn_if_needed()

func _refresh_ui() -> void:
	_render_hand()
	_render_table_deck()
	_render_table_discard()

func _render_hand() -> void:
	# Clear existing hand
	for child in player_hand_container.get_children():
		child.queue_free()
	selected_card = null
	multi_selected.clear()
	
	var your_hand: Array[Card] = GameManager.players[0].hand
	if your_hand.is_empty():
		return
	
	# Dynamic card dimensions based on viewport width
	var viewport_size := get_viewport_rect().size
	var scale_factor := viewport_size.x / 450.0  # Base screen width
	scale_factor = clamp(scale_factor, 0.5, 2.5)
	
	var card_width := 80.0 * scale_factor
	var card_height := 124.0 * scale_factor
	var overlap_percent := 0.80  # Each card covers 80% of previous
	var visible_percent := 0.20  # Only show 20% of card height
	
	# Calculate total width of the hand with overlapping cards
	var total_width := card_width + (your_hand.size() - 1) * card_width * (1.0 - overlap_percent)
	
	# Create a container for proper centering
	var hand_layout := Control.new()
	hand_layout.custom_minimum_size = Vector2(total_width, card_height)
	# Anchor to bottom center
	hand_layout.anchor_left = 0.5
	hand_layout.anchor_right = 0.5
	hand_layout.anchor_top = 1.0
	hand_layout.anchor_bottom = 1.0
	hand_layout.offset_left = -total_width / 2.0
	hand_layout.offset_right = total_width / 2.0
	hand_layout.offset_top = -card_height * visible_percent
	hand_layout.offset_bottom = card_height * (1.0 - visible_percent)
	hand_layout.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hand_layout.mouse_filter = Control.MOUSE_FILTER_IGNORE
	player_hand_container.add_child(hand_layout)
	
	# Load the card scene
	var packed: PackedScene = load("res://scenes/Card.tscn") as PackedScene
	
	for i in range(your_hand.size()):
		var c := your_hand[i]
		var card_view: CardView = packed.instantiate() as CardView
		card_view.card = c
		card_view.clicked.connect(_on_hand_card_clicked)
		
		# Position with overlap relative to hand_layout
		var x_pos := i * card_width * (1.0 - overlap_percent)
		card_view.position = Vector2(x_pos, 0)
		card_view.z_index = i  # Stack from left to right
		
		hand_layout.add_child(card_view)
	
	# Auto-select last drawn card for human to encourage discarding
	if GameManager.current_player_index == 0 and GameManager.turn_phase == GameManager.TurnPhase.PLAY_OR_DISCARD and GameManager.has_drawn_this_turn and hand_layout.get_child_count() > 0:
		var last_child := hand_layout.get_child(hand_layout.get_child_count() - 1)
		if last_child is CardView:
			(last_child as CardView).selected = true
			selected_card = (last_child as CardView).card

func _render_table_deck() -> void:
	# Clear existing deck view
	for child in deck_node.get_children():
		child.queue_free()
	
	# Create a TableDeckView instance
	var deck_view := TableDeckView.new()
	deck_view.deck_size = GameManager.deck.draw_pile.size()
	deck_node.add_child(deck_view)

func _render_table_discard() -> void:
	# Clear existing discard
	for child in discard_node.get_children():
		child.queue_free()
	
	var top: Card = GameManager.deck.top_discard()
	if top:
		var card_view := TableCardView.new()
		card_view.card = top
		discard_node.add_child(card_view)

func _on_hand_card_clicked(card_view: CardView) -> void:
	# Toggle selection with Ctrl to multi-select, otherwise single-select
	if Input.is_key_pressed(KEY_CTRL):
		card_view.selected = not card_view.selected
		if card_view.selected:
			multi_selected.append(card_view.card)
		else:
			multi_selected.erase(card_view.card)
	else:
		# Deselect all cards in hand
		if player_hand_container.get_child_count() > 0:
			var hand_layout := player_hand_container.get_child(0)
			for child in hand_layout.get_children():
				if child is CardView:
					(child as CardView).selected = false
		multi_selected.clear()
		card_view.selected = true
		multi_selected.append(card_view.card)
	selected_card = card_view.card

# Input handling for game actions
func _input(event: InputEvent) -> void:
	# Check if it's the human player's turn
	if GameManager.current_player_index != 0:
		return
	
	# Handle keyboard shortcuts for game actions
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_D:  # Draw from deck
				if GameManager.turn_phase != GameManager.TurnPhase.PLAY_OR_DISCARD or not GameManager.has_drawn_this_turn:
					GameManager.draw_from_deck_for_current()
					_refresh_ui()
			KEY_P:  # Pick up discard
				if GameManager.turn_phase == GameManager.TurnPhase.AWAIT_BUY:
					GameManager.claim_discard_as_draw_for_current()
					_refresh_ui()
			KEY_SPACE:  # Discard selected card
				if selected_card and GameManager.turn_phase == GameManager.TurnPhase.PLAY_OR_DISCARD:
					GameManager.discard_from_current(selected_card)
					_refresh_ui()
			KEY_G:  # Make group from selected cards
				if multi_selected.size() >= 3:
					if GameManager.try_make_group_from_current(multi_selected.duplicate()):
						_refresh_ui()
			KEY_R:  # Make run from selected cards
				if multi_selected.size() >= 4:
					if GameManager.try_make_run_from_current(multi_selected.duplicate()):
						_refresh_ui()
			KEY_B:  # Buy during AI's turn
				if GameManager.turn_phase == GameManager.TurnPhase.AWAIT_BUY and GameManager.current_player().is_ai:
					GameManager.allow_buy_from_non_current_player(0)
					_refresh_ui()
