<img width="1000" alt="Globalping Probe Header" src="https://user-images.githubusercontent.com/1834071/163672135-c96edfe9-7b66-4fe9-92e7-6d225e05f5f3.png">



## Join the Globalping Probe Community

To join the Globalping probe network all you have to do is run our container.

```
docker run -d --network host --restart=always --name globalping-probe ghcr.io/jsdelivr/globalping-probe
```
The container will work on both x86 and ARM architectures.

Once you connect you will become part of the global community that powers the [Globalping Platform](https://github.com/jsdelivr/globalping)


## Where to run

You can run it on anything that can run a docker container. Any kind of linux server hosted with a cloud provider, your home server or even a Raspberry Pi that you have lying around. There is nothing to configure, simply run the container.
The only requirement is a stable internet connection.

## Updating

You don't need to worry about updates. Our probe will automatically update to the latest version as they become available. It will be pulled directly from GitHub and installed within the container. Pulling a fresh version of the container on a regular basis is recommended but completely optional.

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

## Development

1. Clone repository
2. `npm install && npm run build`
3. `NODE_ENV=development node dist/index.js`
