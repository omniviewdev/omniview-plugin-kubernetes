package kubeauth

import (
	"slices"

	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

const (
	awsCliCommand              = "aws"
	awsIamAuthenticatorCommand = "aws-iam-authenticator"
)

// usesExec reports whether the kubeconfig user authenticates through an exec credential plugin.
// A context with no user, or one naming a user that is not in the kubeconfig, has no AuthInfo at
// all. That is a valid anonymous context, not an exec user.
func usesExec(auth *clientcmdapi.AuthInfo) bool {
	return auth != nil && auth.Exec != nil
}

func isEKSAuth(auth *clientcmdapi.AuthInfo) bool {
	return usesExec(auth) &&
		((auth.Exec.Command == awsCliCommand && contains(auth.Exec.Args, "eks")) ||
			(auth.Exec.Command == awsIamAuthenticatorCommand))
}

// IsEKSAuth returns true if the auth info uses EKS authentication (aws CLI or aws-iam-authenticator).
func IsEKSAuth(auth *clientcmdapi.AuthInfo) bool {
	return isEKSAuth(auth)
}

func isGCPAuth(auth *clientcmdapi.AuthInfo) bool {
	return usesExec(auth) && auth.Exec.Command == "gcloud"
}

// IsGCPAuth returns true if the auth info uses GCP/gcloud authentication.
func IsGCPAuth(auth *clientcmdapi.AuthInfo) bool {
	return isGCPAuth(auth)
}

func isAKSAuth(auth *clientcmdapi.AuthInfo) bool {
	return usesExec(auth) && auth.Exec.Command == "az"
}

// IsAKSAuth returns true if the auth info uses Azure AKS authentication.
func IsAKSAuth(auth *clientcmdapi.AuthInfo) bool {
	return isAKSAuth(auth)
}

func contains(list []string, val string) bool {
	return slices.Contains(list, val)
}
