Download PlantUML picoserver:

https://plantuml.com/download

Rename the downloaded file to `plantuml.jar`

```
sudo apt install graphviz
```

On Ubuntu:

Create `/etc/systemd/system/plantuml.service`:

```
[Unit]
Description=PlantUML PicoWeb Server
After=network.target

[Service]
ExecStart=/usr/bin/java -jar /path/to/plantuml.jar -picoweb:8080
Restart=on-failure
User=<yourusername>
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
bashsudo systemctl status plantuml.service
curl http://localhost:8080
```
