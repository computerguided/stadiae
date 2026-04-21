
```
sudo apt install graphviz
curl -O https://github.com/plantuml/plantuml/releases/download/v1.2026.2/plantuml-1.2026.2.jar plantuml.jar > plantum.jar
mv 
java -jar plantuml.jar -picoweb:8000
```

On Ubuntu:

Create `/etc/systemd/system/plantuml.service`:

```
[Unit]
Description=PlantUML PicoWeb Server
After=network.target

[Service]
ExecStart=/usr/bin/java -jar /opt/plantuml/plantuml.jar -picoweb:8000
Restart=on-failure
User=<yourusername>
WorkingDirectory=/opt/plantuml

[Install]
WantedBy=multi-user.target
```
