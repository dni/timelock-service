.PHONY: build run seed

IMAGE_NAME = timelock-service
CONTAINER_NAME = timelock-service
PORT = 6011

build:
	docker build --pull -t $(IMAGE_NAME) .

seed:
	cd backend && python seed_bonds.py

run:
	@echo "Restarting container..."
	docker stop $(CONTAINER_NAME) 2>/dev/null || true
	docker rm $(CONTAINER_NAME) 2>/dev/null || true
	docker run --restart always -d --name $(CONTAINER_NAME) \
		-p $(PORT):8000 \
		--env-file .env \
		-v $(PWD)/backend/data:/app/data \
		$(IMAGE_NAME)
	@echo "Container $(CONTAINER_NAME) is running at http://localhost:$(PORT)"
