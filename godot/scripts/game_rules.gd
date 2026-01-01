extends Node

class_name GameRules

const ROUNDS: Array = [
	{"groups": 2, "runs": 0},
	{"groups": 1, "runs": 1},
	{"groups": 0, "runs": 2},
	{"groups": 3, "runs": 0},
	{"groups": 2, "runs": 1},
	{"groups": 1, "runs": 2},
	{"groups": 0, "runs": 3},
]

static func is_valid_group(cards: Array[Card]) -> bool:
	if cards.size() < 3:
		return false
	var non_wild_numbers: Array[int] = []
	var num_wild := 0
	for c in cards:
		if c.is_wild():
			num_wild += 1
		else:
			non_wild_numbers.append(c.number)
	non_wild_numbers = non_wild_numbers.duplicate()
	if num_wild > 1:
		return false
	if non_wild_numbers.is_empty():
		return false
	for n in non_wild_numbers:
		if n != non_wild_numbers[0]:
			return false
	return true

static func is_valid_run(cards: Array[Card]) -> bool:
	if cards.size() < 4:
		return false
	var colors: Array[int] = []
	var numbers: Array[int] = []
	var num_wild := 0
	for c in cards:
		if c.is_wild():
			num_wild += 1
		else:
			colors.append(int(c.color))
			numbers.append(c.number)
	if num_wild > 1:
		return false
	if numbers.is_empty():
		return false
	# All colors equal
	for col in colors:
		if col != colors[0]:
			return false
	numbers.sort()
	# Check consecutive allowing one gap for wild
	var gaps := 0
	for i in range(1, numbers.size()):
		var diff := numbers[i] - numbers[i - 1]
		if diff == 1:
			continue
		elif diff == 2:
			gaps += 1
		else:
			return false
	if num_wild == 1 and gaps <= 1:
		return true
	if num_wild == 0 and gaps == 0:
		return true
	return false

static func score_hand(cards: Array[Card]) -> int:
	var total := 0
	for c in cards:
		if c.is_wild():
			total += 20
		elif c.number >= 1 and c.number <= 8:
			total += 5
		elif c.number >= 9 and c.number <= 14:
			total += 10
	return total
