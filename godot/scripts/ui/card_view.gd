extends PanelContainer

class_name CardView

signal clicked(view)

# Base card dimensions (reference size)
const BASE_CARD_WIDTH := 80.0
const BASE_CARD_HEIGHT := 124.0
const BASE_SCREEN_WIDTH := 450.0  # Reference screen width

# Card border styling constants
const CARD_BORDER_WIDTH := 2
const CARD_BORDER_COLOR_NORMAL := Color(0.5, 0.5, 0.5)
const CARD_BORDER_COLOR_SELECTED := Color(1, 0.85, 0.1)

# Static function to create consistent card border style
static func create_card_border_style(selected: bool = false) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color.TRANSPARENT
	style.set_border_width_all(CARD_BORDER_WIDTH)
	style.border_color = CARD_BORDER_COLOR_SELECTED if selected else CARD_BORDER_COLOR_NORMAL
	style.set_content_margin_all(CARD_BORDER_WIDTH)
	return style

var _card: Card
@export var card: Card:
	set(value):
		_card = value
		_refresh()
	get:
		return _card

var _selected: bool = false
var _original_z_index: int = 0
var selected: bool = false:
	set(value):
		_selected = value
		_update_selected_style()
		_update_z_index()
	get:
		return _selected

@onready var texture_rect: TextureRect = $TextureRect

func _ready() -> void:
	_apply_responsive_size()
	_refresh()
	# Listen for viewport size changes
	get_viewport().size_changed.connect(_on_viewport_size_changed)

func _on_viewport_size_changed() -> void:
	_apply_responsive_size()

func _apply_responsive_size() -> void:
	var viewport_size := get_viewport_rect().size
	
	# Calculate scale factor based on viewport width
	var scale_factor := viewport_size.x / BASE_SCREEN_WIDTH
	
	# Clamp scaling to reasonable range
	scale_factor = clamp(scale_factor, 0.5, 2.5)
	
	# Apply scaled size
	custom_minimum_size = Vector2(
		BASE_CARD_WIDTH * scale_factor,
		BASE_CARD_HEIGHT * scale_factor
	)

func _refresh() -> void:
	if not is_inside_tree():
		return
	if _card == null:
		texture_rect.texture = null
		return
	
	# Load the card image
	var card_path := _get_card_image_path(_card)
	texture_rect.texture = load(card_path)
	
	# Apply selection border style
	_apply_style()

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		emit_signal("clicked", self)

func _update_selected_style() -> void:
	_apply_style()
	# Keep constant size; indicate selection via border color only
	self.scale = Vector2(1, 1)

func _update_z_index() -> void:
	if _selected:
		# Store original z_index and bring to front
		_original_z_index = z_index
		z_index = 1000  # High value to ensure it's on top
	else:
		# Restore original z_index
		z_index = _original_z_index

func _apply_style() -> void:
	var style := CardView.create_card_border_style(_selected)
	add_theme_stylebox_override("panel", style)

func _get_card_image_path(c: Card) -> String:
	if c.is_wild():
		return "res://assets/cards/wild.png"
	
	var color_name := ""
	match c.color:
		Card.CardColor.RED:
			color_name = "red"
		Card.CardColor.YELLOW:
			color_name = "yellow"
		Card.CardColor.GREEN:
			color_name = "green"
		Card.CardColor.BLACK:
			color_name = "black"
	
	return "res://assets/cards/%s_%02d.png" % [color_name, c.number]
