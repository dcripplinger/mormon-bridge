extends Resource

class_name Card

enum CardColor {RED, YELLOW, GREEN, BLACK, ROOK}

@export var color: CardColor
@export var number: int = 0

func is_wild() -> bool:
	return color == CardColor.ROOK

func display_text() -> String:
	if is_wild():
		return "ROOK"
	return "%s %d" % [color_to_string(color), number]

static func color_to_string(c: CardColor) -> String:
	match c:
		CardColor.RED:
			return "R"
		CardColor.YELLOW:
			return "Y"
		CardColor.GREEN:
			return "G"
		CardColor.BLACK:
			return "B"
		CardColor.ROOK:
			return "W"
	return "?"

static func make(card_color: CardColor, card_number: int) -> Card:
	var c := Card.new()
	c.color = card_color
	c.number = card_number
	return c
