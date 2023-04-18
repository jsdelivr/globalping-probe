<img width="1000" alt="Globalping Probe Header" src="https://user-images.githubusercontent.com/1834071/163672135-c96edfe9-7b66-4fe9-92e7-6d225e05f5f3.png">



## Join the Globalping Probe Community - [Learn more about it](https://github.com/jsdelivr/globalping)

To join the Globalping probe network all you have to do is run our container.

```
docker run -d --log-driver local --network host --restart=always --name globalping-probe ghcr.io/jsdelivr/globalping-probe
```
The container will work on both x86 and ARM architectures.

Once you connect you will become part of the global community that powers the [Globalping Platform](https://github.com/jsdelivr/globalping)

---
#### Podman alternative
Note that you also need to [install a service](https://linuxhandbook.com/autostart-podman-containers/) to make sure the container starts on boot. 
```
podman run --cap-add=NET_RAW -d --network host --restart=always --name globalping-probe ghcr.io/jsdelivr/globalping-probe
```
---
For automation purposes consider using this template of a [universal installation script for Linux servers](https://gist.github.com/jimaek/7b8312c2c37f9002a5cc0108ebfd43e1).

## Where to run

You can run it on anything that can run a docker container. Any kind of linux server hosted with a cloud provider, your home server or even a Raspberry Pi that you have lying around. There is nothing to configure, simply run the container.
The only requirement is a stable internet connection.

## Updating

You don't need to worry about updates. Our probe will automatically update to the latest version as they become available. It will be pulled directly from GitHub and installed within the container. The container itself won't get updated, only the code it's running. 
Pulling a fresh version of the container on a regular basis is recommended but completely optional.

To update the container all you have to do is

```
docker pull ghcr.io/jsdelivr/globalping-probe
docker stop globalping-probe
docker rm globalping-probe
docker run -d --log-driver local --network host --restart=always --name globalping-probe ghcr.io/jsdelivr/globalping-probe
```

## Limitations

- You can run only 1 probe per IP address
- We will disconnect probes that we can't reliably resolve to a physical location
- We block probes from IPs associated with annonymous proxies, Tor and VPN services.


## Security

- The probe doesn't open any ports or accept any incoming connections. It can only connect to our API over a secure connection.
- We use regularly updated lists and databases of [domains](https://github.com/jsdelivr/globalping/blob/master/src/lib/malware/domain.ts) and [IP addresses](https://github.com/jsdelivr/globalping/blob/master/src/lib/malware/ip.ts) that are associated with malware or potentially dangerous content and completely ban them on the API level.
- We block private IPs from being used as targets
- We rate-limit all users on the API level to avoid the abuse of our network

## Scaling tests

The amount of tests that your probe is able to process will scale according to the amount of available CPU cores and average CPU load over the past few minutes. Our code is very lightweight and won't use too many of your resources, so in most cases we recommend running our probe as is. 
But if you're worried you can use this docker parameter `--cpuset-cpus="0-2"` to limit the number of available cores.

## Sponsors

If you can host our probes in multiple global regions, espesially locations we don't already have, then we would love to work together and list you as a sponsor on our website. Please note that in most cases we ask for at least 6 installed probes to get listed as a sponsor.

To get started or if you have any questions make sure to get in contact with us dak@prospectone.io

## Hardware Probes

<img src="https://user-images.githubusercontent.com/1834071/183153051-5c741c3c-5e8c-4372-ba12-82a602cb7cb6.png" alt="globalping probe" height="200px" align="right"/>

All GitHub Sponsors that contribute $20+ per month are eligible to receive a hardware probe to install in your home or office. 

Installing our hardware probe simplifies the whole process and removes the need of having a computer running 24/7. 
Just connect the probe to your switch or router via an ethernet cable and you are done!

The package includes everything you need to get started:
- An ARM based mini computer in a metal housing
- Quality power supply
- SD Card with OS and probe container pre-installed
- Ethernet patch cable 

Learn more about it on our website! [Get a probe](https://www.jsdelivr.com/globalping)

You can also explore the firmware itself and build your own version if you wish - [Hardware probe firmware](https://github.com/jsdelivr/globalping-hwprobe)

Your company can also become a [hardware probe sponsor!](https://docs.google.com/document/d/1xIe-BaZ-6mmkjN1yMH5Kauw3FTXADrB79w4pnJ4SLa4/edit?usp=sharing)

## Development

You need to have the [main API](https://github.com/jsdelivr/globalping#development) running before running this!

1. Clone repository.
2. `npm install`
3. `npm run dev`

If you run into any errors due to failed scripts, try installing the [unbuffer package](https://command-not-found.com/unbuffer) on your local machine. WSL users will need to do this.
