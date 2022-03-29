


## Join the Globalping Probe Community

To join the Globalping probe network all you have to do is run our container.

```
docker run -d --restart=always ghcr.io/jsdelivr/globalping-probe --name globalping-probe
```

Once you connect you will become part of the global community that powers the [Globalping Platform](https://github.com/jsdelivr/globalping)


## Where to run

You can run it on anything that can run a docker container. Any kind of linux server hosted with a cloud provider, your home server or even a Raspberry Pi that you have lying around. There is nothing to configure, simply run the container.
The only requirement is a stable internet connection.


## Limitations

- You can run only 1 probe per IP address
- We will disconnect probes that we can't reliably resolve to a physical location


## Security

- The probe doesn't open any ports or accept any incoming connections. It can only connect to our API over a secure connection.
- We use regularly updated lists and databases of domains and IPs that are associated with malware or potentially dangerous content and completely ban them on the API level.
- We rate-limit all users on the API level to avoid the abuse of our network

## Scaling tests

The amount of tests that your probe is able to process will scale according to the amount of available CPU cores and average CPU load over the past few minutes. Our code is very lightweight and shouldn't use too many of your resources, so in most cases we recommend running our probe as is. 
But if you're worried you can use this docker parameter `--cpuset-cpus="0-2"` to limit the number of available cores.

## Development

1. Clone repository
2. `npm install && npm run build`
3. `NODE_ENV=development node dist/index.js`
