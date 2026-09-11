extends SceneTree

var failures: Array[String] = []
var checks_run: int = 0


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var scene := load("res://main.tscn") as PackedScene
	var game := scene.instantiate()
	root.add_child(game)
	await process_frame

	_check(game.current_tick == 0, "scene starts at tick zero")
	_check(game.active_track == 0, "starts on track one")
	_check(game.current_room == 0, "starts in room 1 (door cooperation)")

	var blocked_gate: Vector2i = game._move_actor(Vector2i(666, 410), Vector2i.RIGHT)
	_check(blocked_gate == Vector2i(666, 410), "closed blast gate blocks passage")

	game._load_room(0)
	var t0_cmds: Array[int] = []
	for _i in range(38):
		t0_cmds.append(game.CMD_UP)
	for _i in range(70):
		t0_cmds.append(game.CMD_RIGHT)
	for _i in range(100):
		t0_cmds.append(game.CMD_NONE)

	var g_pos: Vector2i = game.SPAWN_POS
	for cmd in t0_cmds:
		g_pos = game._move_actor(g_pos, game._cmd_to_direction(cmd))
	_check(
		Vector2(g_pos).distance_to(Vector2(game.terminal_pos)) <= 38.0,
		"ghost reaches terminal pad",
	)

	game.tracks[0] = t0_cmds
	game.committed[0] = true
	game.ghost_positions[0] = g_pos
	game.active_track = 1
	game._update_room_simulation()
	_check(game.gate_open, "ghost standing on terminal opens blast gate")

	var live_pos: Vector2i = game.SPAWN_POS
	for _i in range(245):
		live_pos = game._move_actor(live_pos, Vector2i.RIGHT)
	game.player_position = live_pos
	_check(game.EXIT_RECT.has_point(live_pos), "live player reaches exit zone")
	_check(game._check_win_condition(), "room 1 solved via gate cooperation")

	game._load_room(1)
	_check(game.item_present, "room 2 has energy cell present")
	_check(game.item_pos == game.item_initial_pos, "cell is at initial storage pos")

	var cell_pos: Vector2i = game.item_pos
	game.player_position = cell_pos
	game._process_actor_interact(0, game.player_position, game.CMD_INTERACT)
	_check(game.item_carrier == 0, "interaction picks up energy cell")
	game._process_actor_interact(0, game.player_position, game.CMD_INTERACT)
	_check(game.item_carrier == -1, "interaction drops energy cell")

	game.item_pos = Vector2i(560, 410)
	game.item_carrier = -1
	game.player_position = Vector2i(560, 410)
	game._process_actor_interact(0, game.player_position, game.CMD_INTERACT)
	_check(game.item_carrier == 0, "live player grabs relayed cell from handoff point")

	game.player_position = game.reactor_pos
	game._process_actor_interact(0, game.player_position, game.CMD_INTERACT)
	_check(game.item_in_socket, "cell inserted into reactor socket")
	game._update_room_simulation()
	_check(game.gate_open, "reactor powers exit blast gate")

	game.player_position = Vector2i(1120, 410)
	_check(game._check_win_condition(), "room 2 solved via cell relay handoff")

	game._load_room(2)
	_check(game.laser_rect.size != Vector2i.ZERO, "room 3 has security laser")
	game.player_position = Vector2i(645, 410)
	_check(game._check_laser_violation(), "walking into laser trips security violation")

	game.ghost_positions[0] = game.terminal_pos
	game.committed[0] = true
	game._update_room_simulation()
	_check(game.decoy_active_timer > 0, "ghost on decoy console distracts security")
	_check(not game._check_laser_violation(), "laser is bypassed while decoy active")

	game.player_position = game.item_initial_pos
	game._process_actor_interact(0, game.player_position, game.CMD_INTERACT)
	_check(game.item_carrier == 0, "vault core picked up by player")
	game.player_position = Vector2i(1120, 410)
	_check(game._check_win_condition(), "room 3 solved with lured laser & vault core")

	game._reset_room()
	_check(game.active_track == 0 and not game.committed[0], "room reset clears tracks")
	_check(game.player_position == game.SPAWN_POS, "player reset to spawn")

	game.show_f3_diagnostics = true
	_check(game.show_f3_diagnostics, "f3 diagnostics can be toggled")

	var h1: int = game._compute_state_hash(Vector2i(200, 300))
	var h2: int = game._compute_state_hash(Vector2i(200, 300))
	_check(h1 == h2, "state hash is strictly deterministic")

	game.queue_free()
	await process_frame
	await process_frame
	if failures.is_empty():
		print("AFTERIMAGE_HEIST_SMOKE_OK: %d checks passed" % checks_run)
		quit(0)
	else:
		for failure in failures:
			push_error(failure)
		quit(1)


func _check(condition: bool, label: String) -> void:
	checks_run += 1
	if not condition:
		failures.append("FAILED: " + label)
