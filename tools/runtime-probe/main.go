package main

import (
	"encoding/json"
	"net"
	"os"
	"sort"
	"strings"
	"syscall"
	"time"
)

type probeResult struct {
	KernelRelease              string            `json:"kernelRelease"`
	UserID                     int               `json:"userId"`
	CredentialEnvironmentNames []string          `json:"credentialEnvironmentNames"`
	ServiceAccountTokenPresent bool              `json:"serviceAccountTokenPresent"`
	KVMDevicePresent           bool              `json:"kvmDevicePresent"`
	KVMAPIVersion              int               `json:"kvmApiVersion"`
	PathPresent                map[string]bool   `json:"pathPresent"`
	Connectivity               map[string]string `json:"connectivity"`
}

func main() {
	result := probeResult{
		KernelRelease:              readTrimmed("/proc/sys/kernel/osrelease"),
		UserID:                     os.Getuid(),
		CredentialEnvironmentNames: credentialEnvironmentNames(os.Environ()),
		ServiceAccountTokenPresent: pathExists("/var/run/secrets/kubernetes.io/serviceaccount/token"),
		KVMDevicePresent:           pathExists("/dev/kvm"),
		KVMAPIVersion:              kvmAPIVersion(),
		PathPresent: map[string]bool{
			"/host":          pathExists("/host"),
			"/home/operator": pathExists("/home/operator"),
			"/root":          pathExists("/root"),
		},
		Connectivity: map[string]string{
			"kubernetesApi":  connectionStatus("kubernetes.default.svc:443"),
			"azureImds":      connectionStatus("169.254.169.254:80"),
			"publicInternet": connectionStatus("1.1.1.1:443"),
		},
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(true)
	if err := encoder.Encode(result); err != nil {
		os.Exit(1)
	}
}

func credentialEnvironmentNames(environment []string) []string {
	names := make([]string, 0)
	for _, entry := range environment {
		name, _, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		if name == "COPILOT_GITHUB_TOKEN" ||
			name == "GH_TOKEN" ||
			name == "GITHUB_TOKEN" ||
			name == "KUBECONFIG" ||
			strings.HasPrefix(name, "AZURE_") {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

func kvmAPIVersion() int {
	device, err := os.OpenFile("/dev/kvm", os.O_RDWR, 0)
	if err != nil {
		return 0
	}
	defer device.Close()

	const kvmGetAPIVersion = 0xae00
	version, _, errno := syscall.Syscall(
		syscall.SYS_IOCTL,
		device.Fd(),
		kvmGetAPIVersion,
		0,
	)
	if errno != 0 {
		return 0
	}
	return int(version)
}

func connectionStatus(address string) string {
	connection, err := net.DialTimeout("tcp", address, 2*time.Second)
	if err != nil {
		return "blocked"
	}
	_ = connection.Close()
	return "reachable"
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func readTrimmed(path string) string {
	content, err := os.ReadFile(path)
	if err != nil {
		return "unavailable"
	}
	return strings.TrimSpace(string(content))
}
