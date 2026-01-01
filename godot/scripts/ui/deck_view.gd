extends Control

class_name DeckView

const CARD_BACK_PATH := "res://assets/cards/back.png"
const BASE_CARD_WIDTH := 80.0
const BASE_CARD_HEIGHT := 124.0
const BASE_SCREEN_WIDTH := 450.0  # Reference screen width
const BASE_STACK_OFFSET := 0.5  # pixels to offset each card (left and up)
const MAX_VISIBLE_CARDS := 20  # Maximum number of card backs to render

var deck_size: int = 0:
	set(value):
		deck_size = value
		_refresh()

func _ready() -> void:
	_refresh()
	# Listen for viewport size changes
	get_viewport().size_changed.connect(_on_viewport_size_changed)

func _on_viewport_size_changed() -> void:
	_refresh()

func _refresh() -> void:
	# Clear existing children
	for child in get_children():
		child.queue_free()
	
	if deck_size <= 0:
		custom_minimum_size = Vector2.ZERO
		return
	
	# Calculate scale factor based on viewport
	var viewport_size := get_viewport_rect().size
	var scale_factor := viewport_size.x / BASE_SCREEN_WIDTH
	scale_factor = clamp(scale_factor, 0.5, 2.5)
	
	var card_width := BASE_CARD_WIDTH * scale_factor
	var card_height := BASE_CARD_HEIGHT * scale_factor
	var stack_offset := BASE_STACK_OFFSET * scale_factor
	
	# Determine how many card backs to render
	var num_to_render := mini(deck_size, MAX_VISIBLE_CARDS)
	
	# Load card back texture
	var card_back_texture: Texture2D = load(CARD_BACK_PATH)
	
	# Create a container to hold the stacked cards
	var stack_container := Control.new()
	var total_offset := (num_to_render - 1) * stack_offset
	stack_container.custom_minimum_size = Vector2(card_width + total_offset, card_height + total_offset)
	add_child(stack_container)
	
	# Create stacked card backs
	for i in range(num_to_render):
		# Create a PanelContainer to hold the card with a border
		var panel := PanelContainer.new()
		
		# Apply border style using shared CardView function
		var style := CardView.create_card_border_style(false)
		panel.add_theme_stylebox_override("panel", style)
		
		# Create the texture rect for the card back
		var texture_rect := TextureRect.new()
		texture_rect.texture = card_back_texture
		texture_rect.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
		texture_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT
		texture_rect.custom_minimum_size = Vector2(card_width, card_height)
		
		panel.add_child(texture_rect)
		
		# Position each card with a slight offset to the left and top
		# Start from bottom-right to keep cards within container bounds
		var offset := i * stack_offset
		panel.position = Vector2(total_offset - offset, total_offset - offset)
		
		stack_container.add_child(panel)
	
	# Set the container size to accommodate the stack
	custom_minimum_size = Vector2(card_width + total_offset, card_height + total_offset)


