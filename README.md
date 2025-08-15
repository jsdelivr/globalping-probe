<img width="1000" alt="Globalping Probe Header" src="https://user-images.githubusercontent.com/1834071/163672135-c96edfe9-7b66-4fe9-92e7-6d225e05f5f3.png">

# Globalping Probe
The [Globalping platform](https://github.com/jsdelivr/globalping) relies on a globally distributed network of community-hosted probes, allowing anyone to run network testing commands like ping or traceroute from any location.

## Join the Globalping probe community
Globalping thrives on the contribution of its community – with your support, we can continuously enhance the platform and provide improved, reliable measurement results to all users free of charge.
We'd be happy to welcome you to our community by hosting a probe!

### Set up a virtual probe
To join the Globalping probe network, all you need to do is run our Docker container, which works on both x86 and ARM architectures. 

Use the following command:


```
docker run -d --log-driver local --network host --restart=always --name globalping-probe globalping/globalping-probe
```

> [!TIP]
> For automation, consider using our [universal installation script for Linux servers](https://gist.github.com/jimaek/7b8312c2c37f9002a5cc0108ebfd43e1) and adapting it as needed.

### Podman alternative
For users opting for Podman, [follow the instructions here](https://linuxhandbook.com/autostart-podman-containers/) to make sure the container automatically starts on boot. Also, check the container logs to see if it started successfully, as Podman may still require additional permissions.
Run the container with the following command:
```
sudo podman run --cap-add=NET_RAW -d --network host --restart=always --name globalping-probe globalping/globalping-probe
```

### Alternative registry
In case the main Docker Hub registry is inaccessible to your server for any reason, you can use our official GitHub Packages mirror.

```
docker run -d --log-driver local --network host --restart=always --name globalping-probe ghcr.io/jsdelivr/globalping-probe
```
Note that ghcr.io does not support IPv6 at the moment.

## Adopt your probes
Every new probe that comes online is a great help to our platform and the community, and we want to encourage everyone to start new probes on every available hardware!

If you're also an active user of Globalping who needs higher than free limits, we recommend you register on the [Globalping Dashboard](https://dash.globalping.io/) and adopt your probes.

Every adopted probe will generate additional daily credits that you can use to run even more tests.

Learn more about [Globalping credits](https://globalping.io/credits)

### Automated adoption

You can also make the adoption process fully automated by setting an environment variable
`GP_ADOPTION_TOKEN` to your unique adoption token. Simply check the [Dashboard](https://dash.globalping.io/probes?view=start-a-probe) for a personalized command that includes the token.

Note that anyone who knows your adoption token will be able to register new probes under your account.

## Where to run
You can run the virtual probe on anything that can run a Docker container, supporting x86 and ARM architectures. This includes any Linux server hosted with a cloud provider, your home server, or even a Raspberry Pi lying around at your office. 

No configuration is needed; just run the container with a stable internet connection.

## How to update 
You don't need to worry about updates: The probe automatically updates to the latest version as soon as it becomes available. It's pulled directly from GitHub and installed within the container.

> [!NOTE]
> The container itself isn't updated automatically, only the code it runs.

### Optional: Container update
As the automatic update doesn’t update the container, we recommend you pull a fresh version of the container regularly.

To update the container, run the following:

```
docker pull globalping/globalping-probe
docker stop globalping-probe
docker rm globalping-probe
docker run -d --log-driver local --network host --restart=always --name globalping-probe globalping/globalping-probe
```

## Limitations
- You can run only one (1) probe per IP address.
- We disconnect probes that we can't reliably resolve to a physical location.
- We block probes whose traffic is routed through anonymous proxies, Tor exit nodes, or VPN services.


## Security
- The probe only connects to our API over a secure connection; it doesn't open ports on your device or accepts any incoming connections.
- We use regularly updated lists and databases of [domains](https://github.com/jsdelivr/globalping/blob/master/src/lib/malware/domain.ts) and [IP addresses](https://github.com/jsdelivr/globalping/blob/master/src/lib/malware/ip.ts) associated with malware or potentially dangerous content and ban them on the API level.
- We block private IP addresses as targets.
- We rate-limit all users on the API level to prevent network abuse.

## Adjusting the number of tests
The amount of measurement tests your probe can process scales with the available CPU cores and average CPU load over the past few minutes. Our code is very lightweight and doesn't take up too many resources, so in most cases, **we recommend running our probe as is**.

However, if you still want to control resource usage, add the docker parameter `--cpuset-cpus="0-2"` to your `docker run` command and set the number of CPUs within the quotes.

## Hardware Probes
<img src="https://user-images.githubusercontent.com/1834071/183153051-5c741c3c-5e8c-4372-ba12-82a602cb7cb6.png" alt="globalping probe" height="200px" align="right"/>

As a GitHub Sponsor contributing $10+ per month, you can request a hardware probe and install it at home or in your office.

### How does it work?
Connect the probe to your switch or router, and you are done! No need to set up the Docker container yourself or have a computer running 24/7.

The hardware probe package includes everything you need to get started:
- ARM-based mini computer in a metal housing
- Power supply
- SD card with pre-installed OS and probe container
- Ethernet patch cable

To request a probe, become a GitHub Sponsor and [fill out this form](https://docs.google.com/forms/d/e/1FAIpQLSetKnI7CheDuwgl8QeARu2XzhXTXmek0GdKkpN5MW7WV3pVtw/viewform).

> [!TIP]
> You can also explore the hardware probe's firmware and build your own version. Learn more [here](https://github.com/jsdelivr/globalping-hwprobe).

### Become a hardware probe provider
We offer companies to sponsor co-branded hardware probes to hand out at conferences or ship to your users with your own stickers and swag included.

Learn more about [becoming a hardware probe provider](https://docs.google.com/document/d/1xIe-BaZ-6mmkjN1yMH5Kauw3FTXADrB79w4pnJ4SLa4/edit?usp=sharing).

## Support and feedback

If you are stuck or want to give us your feedback, please [open a new issue](https://github.com/jsdelivr/globalping-probe/issues).

## Development
Please refer to [CONTRIBUTING.md](CONTRIBUTING.md) for more information.
