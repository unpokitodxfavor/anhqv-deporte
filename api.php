<?php
/**
 * api.php - Backend para Amazfit Ultra Tracker
 * Permite persistir las actividades en una base de datos MySQL.
 */

// --- CONFIGURACIÓN DE BD (Rellena estos datos) ---
define('DB_HOST', 'localhost');
define('DB_NAME', 'anhqv-deporte');
define('DB_USER', 'deporte');
define('DB_PASS', 'Efese2025@');

// --- CABECERAS ---
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE');
header('Access-Control-Allow-Headers: Content-Type');

// --- CONEXIÓN ---
try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4", DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    die(json_encode(['error' => 'Error de conexión: ' . $e->getMessage()]));
}

// --- CREAR TABLA SI NO EXISTE ---
$pdo->exec("CREATE TABLE IF NOT EXISTS activities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp BIGINT UNIQUE NOT NULL,
    distance FLOAT,
    duration VARCHAR(20),
    data JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)");

// --- RUTAS ---
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method === 'GET') {
    // Obtener todas las actividades
    $stmt = $pdo->query("SELECT data FROM activities ORDER BY timestamp DESC");
    $results = $stmt->fetchAll();
    echo json_encode(array_map(function ($row) {
        return json_decode($row['data'], true);
    }, $results));
} elseif ($method === 'POST') {
    // Guardar una actividad
    $input = json_decode(file_get_contents('php://input'), true);
    if (!isset($input['timestamp']))
        die(json_encode(['error' => 'Faltan datos']));

    $stmt = $pdo->prepare("INSERT IGNORE INTO activities (timestamp, distance, duration, data) VALUES (?, ?, ?, ?)");
    $stmt->execute([
        $input['timestamp'],
        $input['stats']['distance'] ?? 0,
        $input['stats']['duration'] ?? '00:00:00',
        json_encode($input)
    ]);
    echo json_encode(['success' => true]);
} elseif ($method === 'DELETE') {
    // Borrar una actividad
    $timestamp = $_GET['timestamp'] ?? '';
    if (!$timestamp)
        die(json_encode(['error' => 'Faltan datos']));

    $stmt = $pdo->prepare("DELETE FROM activities WHERE timestamp = ?");
    $stmt->execute([$timestamp]);
    echo json_encode(['success' => true]);
}
