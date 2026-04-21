# Running PlantUML server locally

## Requirements

### Java

Check if Java is installed on your system:

```
which java
```

Otherwise, install it:

```
sudo apt update
sudo apt install default-jdk
```

## Install PlantUML picoserver

### Download

Download PlantUML picoserver and rename the downloaded file to `plantuml.jar`.

```
sudo curl -L -o plantuml.jar https://github.com/plantuml/plantuml/releases/download/v1.2026.2/plantuml-epl-1.2026.2.jar
```

The server can now be run in the terminal.

```
java -jar plantuml.jar -picoweb:8080
```

However, a more convenient solution is to start it as a permanent service as described in the next section.

### Create PlantUML service

Create the `plantuml.service` file:

```
sudo nano /etc/systemd/system/plantuml.service
```

Add the following - change the path and username accordingly:

```
[Unit]
Description=PlantUML PicoWeb Server
After=network.target

[Service]
ExecStart=/usr/bin/java -jar /path/to/plantuml/plantuml.jar -picoweb:8080
Restart=on-failure
User=your_user_name
WorkingDirectory=/path/to/plantuml

[Install]
WantedBy=multi-user.target
```

Then

```
sudo systemctl daemon-reload
sudo systemctl enable --now plantuml.service
```

Check it's running:

```
sudo systemctl status plantuml.service
curl http://localhost:8080
```

