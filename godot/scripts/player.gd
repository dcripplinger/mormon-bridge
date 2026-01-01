extends Resource

class_name Player

@export var player_id: int
@export var display_name: String = ""
@export var is_ai: bool = false

var hand: Array[Card] = []
var has_gone_down: bool = false

func sort_hand() -> void:
	hand.sort_custom(_compare_cards)

static func _compare_cards(a: Card, b: Card) -> bool:
	if a.is_wild() and b.is_wild():
		return false
	if a.is_wild():
		return false
	if b.is_wild():
		return true
	if a.color == b.color:
		return a.number < b.number
	return int(a.color) < int(b.color)
