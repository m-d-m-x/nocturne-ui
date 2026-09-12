# if you ever lose connection: New-NetIPAddress -InterfaceAlias "Ethernet 3" -IPAddress 172.16.42.1 -PrefixLength 24
bun vite build
ssh -i ../id_rsa root@172.16.42.2 "mount -o remount,rw /&&\rm -rf /etc/nocturne/ui/*&&\rm -rf /var/cache/chrome_storage/Default/Cache/*"
scp -i ../id_rsa -r dist/* root@172.16.42.2:/etc/nocturne/ui/
ssh -i ../id_rsa root@172.16.42.2 "mount -o remount,ro /&&\sync &&\sv restart nocturne-ui &&\sv restart chromium"