package main

import (
	"fmt"
	"os"
	"os/user"
	"sync"

	log "github.com/sirupsen/logrus"
)

var (
	homedirOnce sync.Once
	homedir     string
)

func getHome() string {
	homedirOnce.Do(func() {
		env, err := os.UserHomeDir()
		if env == "" || err != nil {
			usr, err := user.LookupId(fmt.Sprintf("%d", os.Getuid()))
			if err != nil {
				log.Error("Could not determine user home directory!")
				homedir = ""
				return
			}

			homedir = usr.HomeDir
			return
		}
		homedir = env
	})
	return homedir
}
