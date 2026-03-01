-- SQL para crear la base de datos y la tabla de Amazfit Tracker
-- Base de datos: `anhqv-deporte`

CREATE TABLE IF NOT EXISTS `activities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `timestamp` bigint(20) NOT NULL COMMENT 'Timestamp único de la actividad para evitar duplicados',
  `distance` float DEFAULT NULL,
  `duration` varchar(20) DEFAULT NULL,
  `data` json DEFAULT NULL COMMENT 'JSON completo con los puntos GPS y estadísticas',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
