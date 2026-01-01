extends Node

class_name Deck

const STARTING_HAND_SIZE: int = 11

var draw_pile: Array[Card] = []
var discard_pile: Array[Card] = []

func _ready() -> void:
	if draw_pile.is_empty():
		build_three_rook_decks()
		shuffle()

func build_three_rook_decks() -> void:
	draw_pile.clear()
	discard_pile.clear()
	for _i in range(3):
		for color in [Card.CardColor.RED, Card.CardColor.YELLOW, Card.CardColor.GREEN, Card.CardColor.BLACK]:
			for number in range(1, 15):
				draw_pile.append(Card.make(color, number))
		# One rook (wild)
		draw_pile.append(Card.make(Card.CardColor.ROOK, 0))

func shuffle() -> void:
	draw_pile.shuffle()

func draw() -> Card:
	if draw_pile.is_empty():
		reshuffle_from_discard()
	if draw_pile.is_empty():
		return null
	return draw_pile.pop_back()

func top_discard() -> Card:
	if discard_pile.is_empty():
		return null
	return discard_pile[discard_pile.size() - 1]

func take_top_discard() -> Card:
	if discard_pile.is_empty():
		return null
	return discard_pile.pop_back()

func discard(card: Card) -> void:
	discard_pile.append(card)

func deal_hands(num_players: int) -> Array:
	var hands: Array = []
	for _i in range(num_players):
		var hand: Array[Card] = []
		hands.append(hand)
	for _card_index in range(STARTING_HAND_SIZE):
		for player_index in range(num_players):
			var card: Card = draw()
			if card:
				(hands[player_index] as Array[Card]).append(card)
	return hands

func reshuffle_from_discard() -> void:
	if discard_pile.size() <= 1:
		return
	var top: Card = discard_pile.pop_back()
	var new_draw: Array[Card] = []
	for c in discard_pile:
		new_draw.append(c)
	draw_pile = new_draw
	discard_pile.clear()
	discard_pile.append(top)
	shuffle()
