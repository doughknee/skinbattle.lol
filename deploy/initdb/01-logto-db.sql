-- Creates the separate database Logto uses (the app uses the default `skinbattle` db).
SELECT 'CREATE DATABASE logto'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'logto')\gexec
