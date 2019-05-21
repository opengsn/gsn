package test

import (
	"testing"
)

func ErrFail(err error, t *testing.T) {
	if err != nil {
		t.Error(err)
		t.FailNow()
	}
}

func ErrFailWithDesc(err error, t *testing.T, desc string) {
	if err != nil {
		t.Error(desc, err)
		t.FailNow()
	}
}
