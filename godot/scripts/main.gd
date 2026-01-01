extends Control

@onready var player_hand_container: Control = $PlayerHand
@onready var deck_button: Button = $VBox/TopBar/DrawDeckButton
@onready var draw_discard_button: Button = $VBox/TopBar/DrawDiscardButton
@onready var discard_selected_button: Button = $VBox/TopBar/DiscardSelectedButton
@onready var buy_button: Button = $VBox/TopBar/BuyButton
@onready var info_label: Label = $VBox/TopBar/InfoLabel
@onready var deck_view_container: Control = $VBox/Table/DeckAndDiscardRow/DeckArea/DeckView
@onready var discard_area: HBoxContainer = $VBox/Table/DeckAndDiscardRow/DiscardArea/DiscardCard
@onready var melds_box: VBoxContainer = $VBox/Table/Melds

var selected_card: Card = null
var multi_selected: Array[Card] = []

var buy_window_timer: Timer

func _ready() -> void:
	GameManager.state_changed.connect(_refresh_ui)
	GameManager.buy_window_opened.connect(_on_buy_window_opened)
	GameManager.buy_window_closed.connect(_on_buy_window_closed)
	buy_window_timer = Timer.new()
	buy_window_timer.one_shot = true
	add_child(buy_window_timer)
	buy_window_timer.timeout.connect(_on_buy_window_timeout)
	GameManager.new_local_game(1, 2)
	_refresh_ui()

func _on_buy_window_opened() -> void:
	var is_ai_turn := GameManager.current_player().is_ai
	buy_button.visible = is_ai_turn
	if is_ai_turn:
		buy_button.disabled = GameManager.deck.top_discard() == null
		buy_window_timer.start(2.0)
		info_label.text = "AI turn: You may buy the discard"

func _on_buy_window_closed() -> void:
	buy_button.visible = false
	if buy_window_timer.time_left > 0:
		buy_window_timer.stop()

func _on_buy_window_timeout() -> void:
	# Proceed with AI turn
	GameManager.draw_from_deck_for_current()
	await get_tree().process_frame
	GameManager.perform_ai_turn_if_needed()

func _refresh_ui() -> void:
	info_label.text = _build_info_text()
	_render_hand()
	_render_deck()
	_render_discard()
	_render_melds()
	_update_buttons()
	_update_tooltips()

func _build_info_text() -> String:
	var base := "Round %d - Current: %s" % [GameManager.round_index + 1, GameManager.current_player().display_name]
	var phase_text := ""
	match GameManager.turn_phase:
		GameManager.TurnPhase.AWAIT_BUY:
			phase_text = " | Phase: Buy window / Choose draw"
		GameManager.TurnPhase.DRAW:
			phase_text = " | Phase: Draw"
		GameManager.TurnPhase.PLAY_OR_DISCARD:
			phase_text = " | Select a card to discard" if GameManager.current_player_index == 0 and GameManager.has_drawn_this_turn else " | Phase: Play/Discard"
		GameManager.TurnPhase.ROUND_END:
			phase_text = " | Round end"
	return base + phase_text

func _render_hand() -> void:
	for child in player_hand_container.get_children():
		child.queue_free()
	selected_card = null
	multi_selected.clear()
	var packed: PackedScene = load("res://scenes/Card.tscn") as PackedScene
	var your_hand: Array[Card] = GameManager.players[0].hand
	
	# Dynamic card dimensions based on viewport size
	var viewport_size := get_viewport_rect().size
	var scale_factor := viewport_size.x / 450.0  # Base screen width
	scale_factor = clamp(scale_factor, 0.5, 2.5)
	
	var card_width := 80.0 * scale_factor
	var card_height := 124.0 * scale_factor
	var overlap_percent := 0.80  # Each card covers 80% of previous
	var visible_percent := 0.20  # Only show 20% of card height
	
	# Calculate total width of the hand with overlapping cards
	var total_width := card_width + (your_hand.size() - 1) * card_width * (1.0 - overlap_percent)
	
	# Create an HBoxContainer for proper centering
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
	
	for i in range(your_hand.size()):
		var c := your_hand[i]
		var card_view: CardView = packed.instantiate() as CardView
		card_view.card = c
		card_view.clicked.connect(_on_card_clicked)
		
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

func _render_deck() -> void:
	# Clear existing deck view
	for child in deck_view_container.get_children():
		child.queue_free()
	
	# Create a DeckView instance
	var deck_view := DeckView.new()
	deck_view.deck_size = GameManager.deck.draw_pile.size()
	deck_view_container.add_child(deck_view)

func _render_discard() -> void:
	for child in discard_area.get_children():
		child.queue_free()
	var top: Card = GameManager.deck.top_discard()
	if top:
		var packed: PackedScene = load("res://scenes/Card.tscn") as PackedScene
		var card_view: CardView = packed.instantiate() as CardView
		card_view.card = top
		discard_area.add_child(card_view)

func _render_melds() -> void:
	for child in melds_box.get_children():
		child.queue_free()
	var packed: PackedScene = load("res://scenes/Card.tscn") as PackedScene
	for meld in GameManager.table_melds:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var label := Label.new()
		label.text = "%s %s" % ["P%d" % (int(meld["owner"]) + 1), meld["type"]]
		label.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		row.add_child(label)
		for c in meld["cards"]:
			var card_view: CardView = packed.instantiate() as CardView
			card_view.card = c
			row.add_child(card_view)
		melds_box.add_child(row)

func _update_buttons() -> void:
	var is_your_turn := GameManager.current_player_index == 0
	deck_button.disabled = not is_your_turn or GameManager.turn_phase == GameManager.TurnPhase.PLAY_OR_DISCARD and GameManager.has_drawn_this_turn
	draw_discard_button.disabled = not is_your_turn or GameManager.turn_phase != GameManager.TurnPhase.AWAIT_BUY
	discard_selected_button.disabled = not is_your_turn or selected_card == null or GameManager.turn_phase != GameManager.TurnPhase.PLAY_OR_DISCARD
	buy_button.disabled = GameManager.deck.top_discard() == null
	$VBox/TopBar/MakeGroupButton.disabled = multi_selected.size() < 3
	$VBox/TopBar/MakeRunButton.disabled = multi_selected.size() < 4

func _update_tooltips() -> void:
	deck_button.tooltip_text = "Draw the top card from the deck"
	draw_discard_button.tooltip_text = "Draw the top discard as your draw"
	discard_selected_button.tooltip_text = "Select a card in your hand to discard" if selected_card == null else "Discard the selected card"
	buy_button.tooltip_text = "Buy the top discard during AI's buy window"

func _on_card_clicked(card_view: CardView) -> void:
	# Toggle selection with Ctrl to multi-select, otherwise single-select
	if Input.is_key_pressed(KEY_CTRL):
		card_view.selected = not card_view.selected
		if card_view.selected:
			multi_selected.append(card_view.card)
		else:
			multi_selected.erase(card_view.card)
	else:
		# Deselect all cards in hand (they're now in a layout container)
		if player_hand_container.get_child_count() > 0:
			var hand_layout := player_hand_container.get_child(0)
			for child in hand_layout.get_children():
				if child is CardView:
					(child as CardView).selected = false
		multi_selected.clear()
		card_view.selected = true
		multi_selected.append(card_view.card)
	selected_card = card_view.card
	_update_buttons()

func _on_MakeGroupButton_pressed() -> void:
	if multi_selected.size() >= 3:
		if GameManager.try_make_group_from_current(multi_selected.duplicate()):
			_refresh_ui()

func _on_MakeRunButton_pressed() -> void:
	if multi_selected.size() >= 4:
		if GameManager.try_make_run_from_current(multi_selected.duplicate()):
			_refresh_ui()

func _on_DrawDeckButton_pressed() -> void:
	GameManager.draw_from_deck_for_current()
	_refresh_ui()

func _on_DrawDiscardButton_pressed() -> void:
	GameManager.claim_discard_as_draw_for_current()
	_refresh_ui()

func _on_DiscardSelectedButton_pressed() -> void:
	if selected_card:
		GameManager.discard_from_current(selected_card)
		_refresh_ui()

func _on_BuyButton_pressed() -> void:
	# Human buys during AI's buy window
	var bought := GameManager.allow_buy_from_non_current_player(0)
	_refresh_ui()
