extends Node2D

## 6-Second Time Heist prototype.
## Past attempts become tools (and sometimes obstacles) for the next infiltration.

enum RoomId {
	ROOM_DOOR = 0,
	ROOM_RELAY = 1,
	ROOM_LURE = 2,
}

enum ActorCarrier {
	CARRIER_NONE = -1,
	CARRIER_PLAYER = 0,
	CARRIER_GHOST_0 = 1,
	CARRIER_GHOST_1 = 2,
}

const PHYSICS_TPS := 60
const LOOP_TICKS := 360
const MAX_TRACKS := 2
const SPEED_PER_TICK := 4
const ACTOR_HALF_SIZE := 14
const INTERACT_RADIUS := 44.0

const CMD_NONE := 0
const CMD_UP := 1
const CMD_DOWN := 2
const CMD_LEFT := 4
const CMD_RIGHT := 8
const CMD_INTERACT := 16

const WORLD_RECT := Rect2i(40, 160, 1200, 500)
const SPAWN_POS := Vector2i(140, 410)
const EXIT_RECT := Rect2i(1110, 350, 90, 120)

const COLOR_BG := Color("0d1117")
const COLOR_FLOOR := Color("161b22")
const COLOR_GRID := Color("21262d")
const COLOR_WALL := Color("30363d")
const COLOR_CYAN := Color("00e5ff")
const COLOR_AMBER := Color("ffb300")
const COLOR_GREEN := Color("00e676")
const COLOR_DANGER := Color("ff5263")
const COLOR_SUCCESS := Color("64ffda")
const COLOR_MUTED := Color("8b949e")
const TRACK_COLORS := [Color("ffb300"), Color("00e676")]

var tracks: Array = [[], []]
var track_hashes: Array = [[], []]
var committed: Array[bool] = [false, false]
var ghost_positions: Array[Vector2i] = [SPAWN_POS, SPAWN_POS]
var ghost_facings: Array[Vector2i] = [Vector2i.RIGHT, Vector2i.RIGHT]
var player_position: Vector2i = SPAWN_POS
var player_facing: Vector2i = Vector2i.RIGHT
var active_track: int = 0
var current_tick: int = 0
var cycle_running: bool = false
var paused: bool = false
var scrub_limit_tick: int = 0
var interact_buffered: bool = false
var current_room: int = RoomId.ROOM_DOOR
var stage_cleared: bool = false
var stage_failed: bool = false
var gate_open: bool = false
var desync_detected: bool = false
var status_message: String = ""
var fail_reason: String = ""
var clear_stars: String = ""
var clear_time_sec: float = 0.0
var item_present: bool = false
var item_name: String = ""
var item_pos: Vector2i = Vector2i.ZERO
var item_initial_pos: Vector2i = Vector2i.ZERO
var item_carrier: int = ActorCarrier.CARRIER_NONE
var item_in_socket: bool = false
var terminal_pos: Vector2i = Vector2i.ZERO
var terminal_active: bool = false
var reactor_pos: Vector2i = Vector2i.ZERO
var decoy_active_timer: int = 0
var obstacles: Array[Rect2i] = []
var gate_rect: Rect2i = Rect2i()
var laser_rect: Rect2i = Rect2i()
var show_f3_diagnostics: bool = false
var screen_flash: float = 0.0
var alarm_pulse: float = 0.0
var slowmo_timer: float = 0.0
var audio_player: AudioStreamPlayer = null
var sound_interact: AudioStreamWAV = null
var sound_alarm: AudioStreamWAV = null
var sound_clear: AudioStreamWAV = null
var sound_switch: AudioStreamWAV = null


func _ready() -> void:
	Engine.physics_ticks_per_second = PHYSICS_TPS
	_init_audio()
	_load_room(RoomId.ROOM_DOOR)
	queue_redraw()


func _exit_tree() -> void:
	if audio_player != null:
		audio_player.stop()
		audio_player.stream = null
	sound_interact = null
	sound_alarm = null
	sound_clear = null
	sound_switch = null
	Engine.time_scale = 1.0


func _process(delta: float) -> void:
	if screen_flash > 0.0:
		screen_flash = maxf(0.0, screen_flash - delta * 2.0)
	if alarm_pulse > 0.0:
		alarm_pulse = maxf(0.0, alarm_pulse - delta * 2.0)
	if slowmo_timer > 0.0:
		slowmo_timer = maxf(0.0, slowmo_timer - delta)
		Engine.time_scale = 0.35 if slowmo_timer > 0.0 else 1.0
	queue_redraw()


func _physics_process(_delta: float) -> void:
	if paused or stage_cleared or stage_failed:
		return

	var live_cmd := _read_live_command()
	if not cycle_running and live_cmd != CMD_NONE:
		cycle_running = true

	if not cycle_running:
		return

	for g_idx in range(MAX_TRACKS):
		if committed[g_idx]:
			var ghost_cmd := _track_frame(g_idx, current_tick)
			var ghost_dir := _cmd_to_direction(ghost_cmd)
			if ghost_dir != Vector2i.ZERO:
				ghost_facings[g_idx] = ghost_dir
			ghost_positions[g_idx] = _move_actor(ghost_positions[g_idx], ghost_dir)
			_process_actor_interact(g_idx + 1, ghost_positions[g_idx], ghost_cmd)
			_verify_track_hash(g_idx, current_tick, ghost_positions[g_idx])

	var player_dir := _cmd_to_direction(live_cmd)
	if player_dir != Vector2i.ZERO:
		player_facing = player_dir

	if active_track < MAX_TRACKS:
		tracks[active_track].append(live_cmd)
		player_position = _move_actor(player_position, player_dir)
		_process_actor_interact(0, player_position, live_cmd)
		_record_track_hash(active_track, current_tick, player_position)
	else:
		player_position = _move_actor(player_position, player_dir)
		_process_actor_interact(0, player_position, live_cmd)

	_update_item_carrier_position()
	_update_room_simulation()

	if _check_laser_violation():
		_fail_cycle("보안 레이저 감지! 경보 작동 - 과거 잔상으로 기만 콘솔을 유인하세요.")
		return

	if _check_win_condition():
		_complete_stage()
		return

	current_tick += 1
	if current_tick >= LOOP_TICKS:
		_finish_cycle()


func _input(event: InputEvent) -> void:
	if not event is InputEventKey:
		return
	var key_event := event as InputEventKey
	if not key_event.pressed or key_event.echo:
		return

	match key_event.keycode:
		KEY_F3:
			show_f3_diagnostics = not show_f3_diagnostics
		KEY_R:
			_reset_room()
		KEY_1:
			_load_room(RoomId.ROOM_DOOR)
		KEY_2:
			_load_room(RoomId.ROOM_RELAY)
		KEY_3:
			_load_room(RoomId.ROOM_LURE)
		KEY_E:
			interact_buffered = true
		KEY_SPACE, KEY_ENTER:
			if stage_cleared:
				_load_room((current_room + 1) % 3)
			elif stage_failed:
				_reset_room()
			elif active_track < MAX_TRACKS and tracks[active_track].size() > 0:
				_finish_cycle()
		KEY_P, KEY_TAB:
			if not stage_cleared and not stage_failed:
				_toggle_pause()
		KEY_BRACKETLEFT, KEY_LEFT:
			if paused:
				_scrub_to(current_tick - 10)
		KEY_BRACKETRIGHT, KEY_RIGHT:
			if paused:
				_scrub_to(current_tick + 10)


func _read_live_command() -> int:
	var cmd := CMD_NONE
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		cmd |= CMD_UP
	elif Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		cmd |= CMD_DOWN

	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		cmd |= CMD_LEFT
	elif Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		cmd |= CMD_RIGHT

	if interact_buffered:
		cmd |= CMD_INTERACT
		interact_buffered = false
	return cmd


func _cmd_to_direction(cmd: int) -> Vector2i:
	var dir := Vector2i.ZERO
	if cmd & CMD_UP != 0:
		dir.y -= 1
	elif cmd & CMD_DOWN != 0:
		dir.y += 1
	if cmd & CMD_LEFT != 0:
		dir.x -= 1
	elif cmd & CMD_RIGHT != 0:
		dir.x += 1
	return dir


func _move_actor(origin: Vector2i, direction: Vector2i) -> Vector2i:
	if direction == Vector2i.ZERO:
		return origin
	var candidate := origin + direction * SPEED_PER_TICK
	candidate.x = clampi(
		candidate.x,
		WORLD_RECT.position.x + ACTOR_HALF_SIZE,
		WORLD_RECT.end.x - ACTOR_HALF_SIZE,
	)
	candidate.y = clampi(
		candidate.y,
		WORLD_RECT.position.y + ACTOR_HALF_SIZE,
		WORLD_RECT.end.y - ACTOR_HALF_SIZE,
	)
	if _actor_is_blocked(candidate):
		return origin
	return candidate


func _actor_is_blocked(pos: Vector2i) -> bool:
	var hitbox := Rect2i(
		pos - Vector2i(ACTOR_HALF_SIZE, ACTOR_HALF_SIZE),
		Vector2i(ACTOR_HALF_SIZE * 2, ACTOR_HALF_SIZE * 2),
	)
	for obs in obstacles:
		if obs.intersects(hitbox):
			return true
	if not gate_open and gate_rect.size != Vector2i.ZERO and gate_rect.intersects(hitbox):
		return true
	return false


func _process_actor_interact(carrier_id: int, actor_pos: Vector2i, cmd: int) -> void:
	if cmd & CMD_INTERACT == 0 or not item_present or item_in_socket:
		return

	if item_carrier == carrier_id:
		var near_reactor: bool = (
			reactor_pos != Vector2i.ZERO
			and Vector2(actor_pos).distance_to(Vector2(reactor_pos)) <= INTERACT_RADIUS
		)
		if near_reactor:
			item_in_socket = true
			item_carrier = ActorCarrier.CARRIER_NONE
			item_pos = reactor_pos
			_play_sound(sound_switch)
		else:
			item_carrier = ActorCarrier.CARRIER_NONE
			item_pos = actor_pos
			_play_sound(sound_interact)
	elif item_carrier == ActorCarrier.CARRIER_NONE:
		if Vector2(actor_pos).distance_to(Vector2(item_pos)) <= INTERACT_RADIUS:
			item_carrier = carrier_id
			_play_sound(sound_interact)


func _update_item_carrier_position() -> void:
	if not item_present or item_in_socket:
		return
	if item_carrier == ActorCarrier.CARRIER_PLAYER:
		item_pos = player_position + player_facing * 18
	elif item_carrier == ActorCarrier.CARRIER_GHOST_0:
		item_pos = ghost_positions[0] + ghost_facings[0] * 18
	elif item_carrier == ActorCarrier.CARRIER_GHOST_1:
		item_pos = ghost_positions[1] + ghost_facings[1] * 18


func _update_room_simulation() -> void:
	match current_room:
		RoomId.ROOM_DOOR:
			terminal_active = false
			if Vector2(player_position).distance_to(Vector2(terminal_pos)) <= 38.0:
				terminal_active = true
			for g_idx in range(MAX_TRACKS):
				if (
					committed[g_idx]
					and Vector2(ghost_positions[g_idx]).distance_to(Vector2(terminal_pos)) <= 38.0
				):
					terminal_active = true
			gate_open = terminal_active

		RoomId.ROOM_RELAY:
			gate_open = item_in_socket

		RoomId.ROOM_LURE:
			if decoy_active_timer > 0:
				decoy_active_timer -= 1
			if Vector2(player_position).distance_to(Vector2(terminal_pos)) <= 38.0:
				decoy_active_timer = 180
			for g_idx in range(MAX_TRACKS):
				if (
					committed[g_idx]
					and Vector2(ghost_positions[g_idx]).distance_to(Vector2(terminal_pos)) <= 38.0
				):
					decoy_active_timer = 180
			gate_open = true


func _check_laser_violation() -> bool:
	if current_room != RoomId.ROOM_LURE or decoy_active_timer > 0:
		return false
	var hitbox := Rect2i(
		player_position - Vector2i(ACTOR_HALF_SIZE, ACTOR_HALF_SIZE),
		Vector2i(ACTOR_HALF_SIZE * 2, ACTOR_HALF_SIZE * 2),
	)
	return laser_rect.intersects(hitbox)


func _check_win_condition() -> bool:
	if not EXIT_RECT.has_point(player_position):
		return false
	match current_room:
		RoomId.ROOM_DOOR:
			return gate_open
		RoomId.ROOM_RELAY:
			return item_in_socket
		RoomId.ROOM_LURE:
			return item_carrier == ActorCarrier.CARRIER_PLAYER
	return false


func _track_frame(track_index: int, tick: int) -> int:
	if tick < tracks[track_index].size():
		return tracks[track_index][tick] as int
	return CMD_NONE


func _record_track_hash(track_index: int, tick: int, pos: Vector2i) -> void:
	if tick % PHYSICS_TPS == 0:
		track_hashes[track_index].append(_compute_state_hash(pos))


func _verify_track_hash(track_index: int, tick: int, pos: Vector2i) -> void:
	if tick % PHYSICS_TPS != 0:
		return
	var sample_idx := tick / PHYSICS_TPS
	if sample_idx < track_hashes[track_index].size():
		if _compute_state_hash(pos) != track_hashes[track_index][sample_idx]:
			desync_detected = true


func _compute_state_hash(pos: Vector2i) -> int:
	var item_flag := 1 if item_carrier == ActorCarrier.CARRIER_PLAYER else 0
	return 17 * 31 * 31 + pos.x * 31 + pos.y + item_flag * 1009


func _finish_cycle() -> void:
	if active_track < MAX_TRACKS:
		if tracks[active_track].is_empty():
			return
		committed[active_track] = true
		var done_track := active_track
		active_track += 1
		if active_track < MAX_TRACKS:
			status_message = ("루프 %d 완료! 과거 잔상 확정. [WASD] 다음 루프 침투를 시작하세요!" % [done_track + 1])
			_reset_cycle(false)
		else:
			_fail_cycle("루프 종료 (6.0초): 모든 잔상 소진 — 제한 시간 내 탈출 실패!")
	else:
		_fail_cycle("루프 종료 (6.0초): 제한 시간 내 탈출 실패!")


func _fail_cycle(reason: String) -> void:
	stage_failed = true
	cycle_running = false
	fail_reason = reason
	alarm_pulse = 1.0
	status_message = reason + " — [R] 즉시 재시도"
	_play_sound(sound_alarm)


func _complete_stage() -> void:
	stage_cleared = true
	cycle_running = false
	screen_flash = 1.0
	slowmo_timer = 0.5
	clear_time_sec = float(current_tick) / PHYSICS_TPS
	if active_track == 1 and clear_time_sec <= 4.8:
		clear_stars = "★★★"
	elif active_track <= 1:
		clear_stars = "★★☆"
	else:
		clear_stars = "★☆☆"
	status_message = (
		"★ 하이스트 성공! 클리어: %.2f초 (시도 %d회) %s — [Space] 다음 룸"
		% [clear_time_sec, active_track + 1, clear_stars]
	)
	_play_sound(sound_clear)


func _reset_cycle(clear_committed: bool) -> void:
	current_tick = 0
	cycle_running = false
	paused = false
	stage_failed = false
	player_position = SPAWN_POS
	player_facing = Vector2i.RIGHT
	ghost_positions = [SPAWN_POS, SPAWN_POS]
	ghost_facings = [Vector2i.RIGHT, Vector2i.RIGHT]
	interact_buffered = false
	decoy_active_timer = 0
	terminal_active = false
	gate_open = false
	if clear_committed:
		tracks = [[], []]
		track_hashes = [[], []]
		committed = [false, false]
		active_track = 0
		desync_detected = false
	elif active_track < MAX_TRACKS and not committed[active_track]:
		tracks[active_track].clear()
		track_hashes[active_track].clear()

	if item_present:
		item_pos = item_initial_pos
		item_carrier = ActorCarrier.CARRIER_NONE
		item_in_socket = false


func _reset_room() -> void:
	stage_cleared = false
	stage_failed = false
	fail_reason = ""
	clear_stars = ""
	clear_time_sec = 0.0
	Engine.time_scale = 1.0
	slowmo_timer = 0.0
	screen_flash = 0.0
	alarm_pulse = 0.0
	_load_room(current_room)


func _load_room(room_id: int) -> void:
	current_room = room_id
	obstacles.clear()
	gate_rect = Rect2i()
	laser_rect = Rect2i()
	item_present = false
	item_in_socket = false
	item_carrier = ActorCarrier.CARRIER_NONE
	terminal_pos = Vector2i.ZERO
	reactor_pos = Vector2i.ZERO
	decoy_active_timer = 0

	match room_id:
		RoomId.ROOM_DOOR:
			obstacles.append(Rect2i(680, 160, 32, 190))
			obstacles.append(Rect2i(680, 470, 32, 190))
			gate_rect = Rect2i(680, 350, 32, 120)
			terminal_pos = Vector2i(420, 260)
			status_message = "목표: 과거 잔상으로 스위치를 누르고, 열린 격벽을 돌파하라!"

		RoomId.ROOM_RELAY:
			obstacles.append(Rect2i(340, 160, 32, 180))
			obstacles.append(Rect2i(640, 160, 32, 160))
			obstacles.append(Rect2i(640, 480, 32, 180))
			gate_rect = Rect2i(1050, 350, 32, 120)
			reactor_pos = Vector2i(1000, 410)
			item_present = true
			item_name = "에너지 셀"
			item_initial_pos = Vector2i(220, 250)
			item_pos = item_initial_pos
			status_message = "목표: 에너지 셀을 과거 잔상과 중계하여 반응로에 꽂고 탈출하라!"

		RoomId.ROOM_LURE:
			obstacles.append(Rect2i(640, 160, 32, 190))
			obstacles.append(Rect2i(640, 470, 32, 190))
			laser_rect = Rect2i(640, 350, 32, 120)
			terminal_pos = Vector2i(460, 240)
			item_present = true
			item_name = "금고 코어"
			item_initial_pos = Vector2i(880, 410)
			item_pos = item_initial_pos
			status_message = "목표: 과거 잔상으로 보안 레이저를 유인하고, 금고 코어를 탈취하라!"

	_reset_cycle(true)


func _toggle_pause() -> void:
	paused = not paused
	if paused:
		scrub_limit_tick = current_tick
		status_message = "일시정지: [ / ]로 미리보고 P로 재개"
	else:
		if active_track < MAX_TRACKS:
			tracks[active_track].resize(current_tick)
		status_message = "침투 재개"


func _scrub_to(target_tick: int) -> void:
	current_tick = clampi(target_tick, 0, scrub_limit_tick)
	ghost_positions = [SPAWN_POS, SPAWN_POS]
	ghost_facings = [Vector2i.RIGHT, Vector2i.RIGHT]
	if item_present:
		item_pos = item_initial_pos
		item_carrier = ActorCarrier.CARRIER_NONE
		item_in_socket = false

	for tick in range(current_tick):
		for g_idx in range(MAX_TRACKS):
			if committed[g_idx]:
				var ghost_cmd := _track_frame(g_idx, tick)
				var ghost_dir := _cmd_to_direction(ghost_cmd)
				if ghost_dir != Vector2i.ZERO:
					ghost_facings[g_idx] = ghost_dir
				ghost_positions[g_idx] = _move_actor(ghost_positions[g_idx], ghost_dir)
				_process_actor_interact(g_idx + 1, ghost_positions[g_idx], ghost_cmd)

	if active_track < MAX_TRACKS:
		player_position = SPAWN_POS
		for tick in range(mini(current_tick, tracks[active_track].size())):
			var live_cmd: int = tracks[active_track][tick]
			var dir := _cmd_to_direction(live_cmd)
			if dir != Vector2i.ZERO:
				player_facing = dir
			player_position = _move_actor(player_position, dir)
			_process_actor_interact(0, player_position, live_cmd)

	_update_item_carrier_position()
	_update_room_simulation()
	status_message = (
		"스크럽 미리보기: %.2f초 / %.2f초"
		% [float(current_tick) / PHYSICS_TPS, float(LOOP_TICKS) / PHYSICS_TPS]
	)


func _init_audio() -> void:
	audio_player = AudioStreamPlayer.new()
	add_child(audio_player)
	sound_interact = _generate_beep(880.0, 0.06, 0.3)
	sound_alarm = _generate_beep(220.0, 0.25, 0.4)
	sound_clear = _generate_beep(659.2, 0.35, 0.35)
	sound_switch = _generate_beep(440.0, 0.05, 0.3)


func _generate_beep(freq: float, duration: float, volume: float) -> AudioStreamWAV:
	var rate := 22050
	var total := int(rate * duration)
	var bytes := PackedByteArray()
	bytes.resize(total)
	for i in range(total):
		var t := float(i) / rate
		var env := 1.0 - (float(i) / total)
		var sample := sin(2.0 * PI * freq * t) * env * volume
		bytes[i] = clampi(int(sample * 127.0 + 128.0), 0, 255)
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_8_BITS
	stream.mix_rate = rate
	stream.data = bytes
	return stream


func _play_sound(stream: AudioStreamWAV) -> void:
	if audio_player != null and is_inside_tree() and stream != null:
		audio_player.stream = stream
		audio_player.play()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, Vector2(1280, 720)), COLOR_BG)
	_draw_hud()
	_draw_room()
	_draw_entities()
	_draw_overlay_effects()
	if show_f3_diagnostics:
		_draw_f3_panel()


func _draw_hud() -> void:
	var font := ThemeDB.fallback_font
	var room_labels := ["격벽 협업", "에너지 셀 시간 전달", "레이저 & 경비 유인"]
	var room_title: String = "ROOM %d: %s" % [current_room + 1, room_labels[current_room]]
	draw_string(
		font,
		Vector2(40, 36),
		"6초 시간 하이스트 · 6-SECOND TIME HEIST",
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		20,
		COLOR_CYAN,
	)
	draw_string(
		font,
		Vector2(40, 64),
		room_title,
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		16,
		Color.WHITE,
	)
	draw_string(
		font,
		Vector2(40, 92),
		status_message,
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		15,
		COLOR_SUCCESS if stage_cleared else (COLOR_DANGER if stage_failed else Color("e6edf3")),
	)

	var timer_width := 300.0
	var timer_x := 940.0
	var timer_y := 24.0
	var remaining_sec := maxf(0.0, float(LOOP_TICKS - current_tick) / PHYSICS_TPS)
	var progress := float(current_tick) / LOOP_TICKS
	draw_rect(Rect2(timer_x, timer_y, timer_width, 16), Color("21262d"))
	var meter_color := (
		COLOR_CYAN if progress < 0.7 else (COLOR_AMBER if progress < 0.9 else COLOR_DANGER)
	)
	draw_rect(Rect2(timer_x, timer_y, timer_width * (1.0 - progress), 16), meter_color)
	draw_rect(Rect2(timer_x, timer_y, timer_width, 16), COLOR_WALL, false, 2)
	draw_string(
		font,
		Vector2(timer_x + 85, timer_y + 36),
		"남은 시간: %04.1f초 / 6.0초" % [remaining_sec],
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		15,
		meter_color,
	)

	var track_state := "루프 1 (녹화 중)" if active_track == 0 else "루프 2 (협동 침투)"
	if active_track >= MAX_TRACKS:
		track_state = "최종 라이브 시도"
	draw_string(
		font,
		Vector2(timer_x + 90, timer_y + 58),
		track_state,
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		14,
		COLOR_AMBER,
	)

	var help_text := (
		"WASD: 이동 · E: 상호작용 · Space: 루프 확정 · R: 즉시 재시도 · " + "1/2/3: 룸 전환 · P: 일시정지 · F3: 진단"
	)
	draw_string(
		font,
		Vector2(40, 695),
		help_text,
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		14,
		COLOR_MUTED,
	)


func _draw_room() -> void:
	var font := ThemeDB.fallback_font
	draw_rect(Rect2(WORLD_RECT.position, WORLD_RECT.size), COLOR_FLOOR)
	draw_rect(Rect2(WORLD_RECT.position, WORLD_RECT.size), COLOR_WALL, false, 3)

	for x in range(WORLD_RECT.position.x + 50, WORLD_RECT.end.x, 60):
		for y in range(WORLD_RECT.position.y + 50, WORLD_RECT.end.y, 60):
			draw_circle(Vector2(x, y), 1.5, COLOR_GRID)

	for obs in obstacles:
		draw_rect(Rect2(obs.position, obs.size), COLOR_WALL)
		draw_rect(Rect2(obs.position, obs.size), Color("484f58"), false, 2)

	if gate_rect.size != Vector2i.ZERO:
		if not gate_open:
			draw_rect(Rect2(gate_rect.position, gate_rect.size), COLOR_DANGER)
			draw_line(
				Vector2(gate_rect.position.x, gate_rect.position.y),
				Vector2(gate_rect.end.x, gate_rect.end.y),
				Color("ff7b72"),
				2,
			)
			draw_string(
				font,
				Vector2(gate_rect.position.x - 22, gate_rect.position.y + 65),
				"LOCKED",
				HORIZONTAL_ALIGNMENT_LEFT,
				-1,
				12,
				COLOR_DANGER,
			)
		else:
			var pulse := 0.5 + sin(Time.get_ticks_msec() / 120.0) * 0.25
			draw_rect(
				Rect2(gate_rect.position, gate_rect.size), Color(COLOR_SUCCESS, pulse), false, 3
			)

	if terminal_pos != Vector2i.ZERO:
		var term_color := (
			COLOR_SUCCESS if terminal_active or decoy_active_timer > 0 else COLOR_AMBER
		)
		draw_circle(Vector2(terminal_pos), 26.0, term_color.darkened(0.6))
		draw_circle(Vector2(terminal_pos), 26.0, term_color, false, 2)
		var label := "[E] SWITCH" if current_room == RoomId.ROOM_DOOR else "[E] DECOY"
		draw_string(
			font,
			Vector2(terminal_pos) + Vector2(-36, 6),
			label,
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			13,
			term_color,
		)

	if reactor_pos != Vector2i.ZERO:
		var react_color := COLOR_SUCCESS if item_in_socket else Color("388bfd")
		draw_rect(
			Rect2(Vector2(reactor_pos) - Vector2(20, 20), Vector2(40, 40)),
			react_color.darkened(0.5)
		)
		draw_rect(
			Rect2(Vector2(reactor_pos) - Vector2(20, 20), Vector2(40, 40)), react_color, false, 2
		)
		draw_string(
			font,
			Vector2(reactor_pos) + Vector2(-28, 5),
			"REACTOR",
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			11,
			react_color,
		)

	if laser_rect.size != Vector2i.ZERO:
		if decoy_active_timer <= 0:
			var pulse := 0.7 + sin(Time.get_ticks_msec() / 60.0) * 0.3
			draw_rect(Rect2(laser_rect.position, laser_rect.size), Color(COLOR_DANGER, pulse))
			draw_line(
				Vector2(laser_rect.position.x + 14, laser_rect.position.y),
				Vector2(laser_rect.position.x + 14, laser_rect.end.y),
				Color.WHITE,
				3,
			)
			draw_string(
				font,
				Vector2(laser_rect.position.x - 22, laser_rect.position.y + 65),
				"LASER",
				HORIZONTAL_ALIGNMENT_LEFT,
				-1,
				12,
				COLOR_DANGER,
			)
		else:
			draw_rect(Rect2(laser_rect.position, laser_rect.size), Color(COLOR_GREEN, 0.15))
			draw_rect(
				Rect2(laser_rect.position, laser_rect.size), Color(COLOR_GREEN, 0.5), false, 2
			)
			draw_string(
				font,
				Vector2(laser_rect.position.x - 28, laser_rect.position.y + 65),
				"BYPASSED",
				HORIZONTAL_ALIGNMENT_LEFT,
				-1,
				11,
				COLOR_GREEN,
			)

	draw_rect(Rect2(EXIT_RECT.position, EXIT_RECT.size), Color(COLOR_SUCCESS, 0.15))
	draw_rect(Rect2(EXIT_RECT.position, EXIT_RECT.size), COLOR_SUCCESS, false, 3)
	draw_string(
		font,
		Vector2(EXIT_RECT.position) + Vector2(16, 68),
		"EXTRACTION",
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		14,
		COLOR_SUCCESS,
	)


func _draw_entities() -> void:
	var font := ThemeDB.fallback_font
	for g_idx in range(MAX_TRACKS):
		if committed[g_idx]:
			var ghost_col: Color = TRACK_COLORS[g_idx]
			ghost_col.a = 0.75
			var gp := Vector2(ghost_positions[g_idx])
			var ghost_poly := PackedVector2Array(
				[
					gp + Vector2(0, -16),
					gp + Vector2(16, 0),
					gp + Vector2(0, 16),
					gp + Vector2(-16, 0),
				]
			)
			draw_colored_polygon(ghost_poly, ghost_col)
			ghost_poly.append(ghost_poly[0])
			draw_polyline(ghost_poly, Color.WHITE, 1.5)
			draw_string(
				font,
				gp + Vector2(-20, -22),
				"PAST T%d" % [g_idx + 1],
				HORIZONTAL_ALIGNMENT_LEFT,
				-1,
				12,
				TRACK_COLORS[g_idx],
			)

	var pp := Vector2(player_position)
	var player_poly := PackedVector2Array(
		[
			pp + Vector2(0, -16),
			pp + Vector2(16, 0),
			pp + Vector2(0, 16),
			pp + Vector2(-16, 0),
		]
	)
	draw_colored_polygon(player_poly, COLOR_CYAN)
	player_poly.append(player_poly[0])
	draw_polyline(player_poly, Color.WHITE, 2.5)

	var facing_pt := pp + Vector2(player_facing) * 22.0
	draw_line(pp, facing_pt, Color.WHITE, 2.5)

	if item_present and not item_in_socket:
		var ip := Vector2(item_pos)
		var item_col := COLOR_AMBER if current_room == RoomId.ROOM_RELAY else COLOR_GREEN
		draw_circle(ip, 12.0, item_col)
		draw_circle(ip, 6.0, Color.WHITE)
		draw_string(
			font,
			ip + Vector2(-22, -16),
			item_name,
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			11,
			item_col,
		)


func _draw_overlay_effects() -> void:
	var font := ThemeDB.fallback_font
	if screen_flash > 0.0:
		draw_rect(
			Rect2(Vector2.ZERO, Vector2(1280, 720)), Color(COLOR_SUCCESS, screen_flash * 0.35)
		)
	if alarm_pulse > 0.0:
		draw_rect(Rect2(Vector2.ZERO, Vector2(1280, 720)), Color(COLOR_DANGER, alarm_pulse * 0.35))

	if stage_cleared:
		draw_rect(Rect2(340, 260, 600, 180), Color(0.05, 0.08, 0.12, 0.92))
		draw_rect(Rect2(340, 260, 600, 180), COLOR_SUCCESS, false, 3)
		draw_string(
			font,
			Vector2(460, 310),
			"★ HEIST SUCCESSFUL! ★",
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			24,
			COLOR_SUCCESS,
		)
		draw_string(
			font,
			Vector2(450, 350),
			"탈출 시간: %.2f초 · 평가: %s" % [clear_time_sec, clear_stars],
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			18,
			Color.WHITE,
		)
		draw_string(
			font,
			Vector2(490, 400),
			"[Space / Enter] 다음 룸으로 이동",
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			15,
			COLOR_AMBER,
		)
	elif stage_failed:
		draw_rect(Rect2(340, 260, 600, 180), Color(0.12, 0.04, 0.06, 0.92))
		draw_rect(Rect2(340, 260, 600, 180), COLOR_DANGER, false, 3)
		draw_string(
			font,
			Vector2(490, 310),
			"MISSION FAILED",
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			24,
			COLOR_DANGER,
		)
		draw_string(
			font,
			Vector2(370, 350),
			fail_reason,
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			15,
			Color.WHITE,
		)
		draw_string(
			font,
			Vector2(530, 400),
			"[R] 즉시 재시도",
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			16,
			COLOR_AMBER,
		)


func _draw_f3_panel() -> void:
	var font := ThemeDB.fallback_font
	var px := 860.0
	var py := 450.0
	var pw := 380.0
	var ph := 230.0
	draw_rect(Rect2(px, py, pw, ph), Color(0.05, 0.07, 0.1, 0.92))
	draw_rect(Rect2(px, py, pw, ph), COLOR_CYAN, false, 2)

	var lines := [
		"=== [F3 진단 패널 / DIAGNOSTICS] ===",
		(
			"TPS: %d | TICK: %03d / %03d (%.2fs)"
			% [PHYSICS_TPS, current_tick, LOOP_TICKS, float(current_tick) / PHYSICS_TPS]
		),
		(
			"ROOM: %d | GATE_OPEN: %s | DESYNC: %s"
			% [current_room, str(gate_open), str(desync_detected)]
		),
		"ACTIVE_TRACK: %d | COMMITTED: %s" % [active_track, str(committed)],
		(
			"PLAYER_POS: (%d, %d) | FACING: (%d, %d)"
			% [player_position.x, player_position.y, player_facing.x, player_facing.y]
		),
		(
			"GHOST_0: (%d, %d) | GHOST_1: (%d, %d)"
			% [
				ghost_positions[0].x,
				ghost_positions[0].y,
				ghost_positions[1].x,
				ghost_positions[1].y
			]
		),
		"ITEM: %s | CARRIER: %d | IN_SOCKET: %s" % [item_name, item_carrier, str(item_in_socket)],
		"DECOY_TIMER: %d ticks | HASH_OK: %s" % [decoy_active_timer, str(not desync_detected)],
	]
	for idx in range(lines.size()):
		draw_string(
			font,
			Vector2(px + 14, py + 26 + idx * 24),
			lines[idx],
			HORIZONTAL_ALIGNMENT_LEFT,
			-1,
			13,
			COLOR_CYAN if idx == 0 else Color("c9d1d9"),
		)
