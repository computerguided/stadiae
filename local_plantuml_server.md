# Running PlantUML server locally

## Requirements

### Java

Check if Java is installed on your system:

```
which java
```

Otherwise, download Java from the website (https://www.java.com/en/download/help/linux_x64_install.html)

### Graphviz

Installs the dot-language module.

```
which dot
```

If not present, install it:

```
sudo apt install graphviz
```

## Install PlantUML picoserver

### Download

Download PlantUML picoserver: https://plantuml.com/download.

Rename the downloaded file to `plantuml.jar`.

### Create background server

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
ExecStart=/usr/bin/java -jar /path/to/plantuml.jar -picoweb:8080
Restart=on-failure
User=your_user_name
WorkingDirectory=/opt/plantuml

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
