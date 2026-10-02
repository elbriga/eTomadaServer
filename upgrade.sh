#!/bin/bash

echo "git UP"
git pull

echo "STOP"
docker stop etomada-server

echo "BUILD"
docker compose up -d --build
